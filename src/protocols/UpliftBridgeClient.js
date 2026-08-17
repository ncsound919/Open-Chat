/**
 * Uplift Bridge Protocol Client
 * Connects to the Uplift Agent via its Bridge API for remote session control
 *
 * Architecture: Uplift uses a polling-based bridge with session management
 * - Register environment to get environment_id and environment_secret
 * - Poll for work messages
 * - Decode the base64url work secret (carries session_ingress_token +
 *   api_base_url) so session-authenticated calls use the right token + host
 * - Acknowledge work, heartbeat to extend the lease, send responses via
 *   session events
 * - Optional resumable SSE event stream (Last-Event-ID / from_sequence_num)
 *   for live inbound delivery instead of polling latency
 */

import { safeLog, resolveEndpoint } from "../utils/security.js";
import {
  decodeWorkSecret,
  parseSSEFrames,
  CLIENT_EVENT_TYPE,
} from "./bridge-protocol.js";

/** Polling interval for checking new messages */
const POLL_INTERVAL_MS = 2000;

/** Connection timeout */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Heartbeat interval while a work item is active. The work lease TTL is
 * typically 300s; a 60s heartbeat gives 5x headroom (same ratio the reference
 * bridge uses).
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

/** Reconnect delay for the optional SSE event stream (ms). */
const EVENT_STREAM_RECONNECT_DELAY_MS = 3000;

/** Max reconnect attempts for the event stream before giving up. */
const EVENT_STREAM_MAX_RECONNECTS = 5;

/**
 * Uplift Bridge client
 * Handles OAuth, environment registration, work polling, session control,
 * heartbeat/lease extension, and an optional resumable event stream.
 */
export class UpliftBridgeClient {
  constructor(host, port, token) {
    this.baseUrl = resolveEndpoint(host, port, "http");
    this.token = token; // OAuth access token
    this.environmentId = null;
    this.environmentSecret = null;
    this.sessionId = null;
    this.sessionToken = null; // session_ingress_token from the work secret
    this.sessionApiBaseUrl = null; // api_base_url from the work secret
    this.activeWorkId = null;
    this.polling = false;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.eventSource = null;
    this.eventStreamReconnects = 0;
    this.lastSequenceNum = 0;
    this.onStatusChange = null;
    this.onInboundMessage = null;
    this.onEvent = null;
    this._destroyed = false;
    this.pendingMessages = [];
  }

  async connect(options = {}) {
    if (this._destroyed) {
      throw new Error("Client destroyed");
    }

    try {
      this.onStatusChange?.("connecting");

      // Register bridge environment. When resuming, send the prior
      // backend-issued environment_id so the backend reattaches instead of
      // creating a fresh environment.
      const regResponse = await this._fetch("/v1/environments/bridge", {
        method: "POST",
        body: JSON.stringify({
          machine_name: "open-chat-client",
          directory: "/",
          branch: "main",
          git_repo_url: "",
          max_sessions: 1,
          metadata: { worker_type: "chat" },
          ...(options.reuseEnvironmentId
            ? { environment_id: options.reuseEnvironmentId }
            : {}),
        }),
      });

      if (!regResponse.ok) {
        throw new Error(`Registration failed: ${regResponse.status}`);
      }

      const regData = await regResponse.json();
      this.environmentId = regData.environment_id;
      this.environmentSecret = regData.environment_secret;

      this.onStatusChange?.("connected");

      // Start polling for work
      this._startPolling();
    } catch (error) {
      this.onStatusChange?.("error");
      throw error;
    }
  }

  _startPolling() {
    if (this.polling || this._destroyed) return;

    this.polling = true;
    this._poll();
  }

  async _poll() {
    if (!this.polling || this._destroyed) return;

    try {
      const response = await this._fetch(
        `/v1/environments/${this.environmentId}/work/poll`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.environmentSecret}`,
          },
        }
      );

      if (response.ok) {
        const work = await response.json();

        if (work && work.data) {
          // Got work - this is an incoming session or session event
          await this._handleWork(work);
        }
      }
    } catch (error) {
      safeLog("Uplift poll error:", error.message);
    }

    // Schedule next poll
    if (this.polling && !this._destroyed) {
      this.pollTimer = setTimeout(() => this._poll(), POLL_INTERVAL_MS);
    }
  }

  async _handleWork(work) {
    // Decode the base64url work secret when present — it carries the
    // session_ingress_token + api_base_url for session-authenticated calls.
    if (typeof work.secret === "string" && work.secret) {
      try {
        const secret = decodeWorkSecret(work.secret);
        this.sessionToken = secret.session_ingress_token;
        this.sessionApiBaseUrl = secret.api_base_url;
      } catch (e) {
        safeLog("Uplift work-secret decode error:", e.message);
      }
    }

    // Extract session info.
    // New protocol: work.data.type === 'session' with id in work.data.id.
    // Legacy: work.data.type === 'session_start' with id + session_token inline.
    if (work.data.type === "session" || work.data.type === "session_start") {
      if (work.data.id) this.sessionId = work.data.id;
      if (work.data.session_token) this.sessionToken = work.data.session_token;
    }

    // Track the active work item for heartbeat/stop. Healthchecks don't hold
    // a lease worth heartbeating.
    if (work.id && work.data.type === "session") {
      this.activeWorkId = work.id;
      this._startHeartbeat(work.id);
    }

    // Acknowledge every work item so the queue drains, regardless of type.
    // Use sessionToken when available (post session_start), else environmentSecret.
    const authToken = this.sessionToken || this.environmentSecret;
    try {
      await this._fetch(
        `/v1/environments/${this.environmentId}/work/${work.id}/ack`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );
    } catch (e) {
      safeLog("Failed to acknowledge work item:", e.message);
    }

    // Handle incoming messages
    if (work.data.messages) {
      const userMessages = work.data.messages.filter(
        (m) => m.role === "user" && m.content
      );

      if (userMessages.length > 0) {
        this.pendingMessages.push(...userMessages);
        // Surface inbound agent messages immediately so the UI can render them
        for (const msg of userMessages) {
          this.onInboundMessage?.(msg);
        }
      }
    }
  }

  // ── Heartbeat / lease ────────────────────────────────────────────────────

  /**
   * Start extending the active work item's lease. Stops automatically if the
   * server reports a terminal state or the client is destroyed.
   */
  _startHeartbeat(workId) {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this._destroyed) {
        this._stopHeartbeat();
        return;
      }
      this._sendHeartbeat(workId).catch((e) =>
        safeLog("Uplift heartbeat error:", e.message)
      );
    }, HEARTBEAT_INTERVAL_MS);
  }

  async _sendHeartbeat(workId) {
    const response = await this._fetch(
      `/v1/environments/${this.environmentId}/work/${workId}/heartbeat`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.sessionToken || this.environmentSecret}`,
        },
      }
    );
    if (!response.ok) {
      safeLog("Uplift heartbeat failed:", response.status);
      return;
    }
    const data = await response.json().catch(() => null);
    // Terminal state -> stop heartbeating; the lease no longer needs extending.
    if (data?.state === "completed" || data?.state === "failed") {
      this._stopHeartbeat();
      this.activeWorkId = null;
    }
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Session control ──────────────────────────────────────────────────────

  /**
   * Force-stop the active work item.
   * @param {boolean} [force=false] hard-kill the session
   */
  async stop(force = false) {
    if (!this.activeWorkId) return;
    const workId = this.activeWorkId;
    try {
      await this._fetch(
        `/v1/environments/${this.environmentId}/work/${workId}/stop`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.sessionToken || this.environmentSecret}`,
          },
          body: JSON.stringify({ force }),
        }
      );
    } finally {
      this._stopHeartbeat();
      this.activeWorkId = null;
    }
  }

  // ── Resumable SSE event stream (CCR v2) ─────────────────────────────────

  /**
   * Open a persistent SSE event stream against the session ingress API.
   * Supports resumption via from_sequence_num / Last-Event-ID so a reconnect
   * does not replay the entire session history. Delivers `client_event`
   * payloads to onEvent / onInboundMessage.
   *
   * Requires an active session (work secret decoded). Falls back to polling if
   * no session is established yet or the stream cannot be opened.
   *
   * @param {object} [options]
   * @param {number} [options.fromSequenceNum] high-water mark to resume from
   * @param {boolean} [options.autoReconnect=true]
   */
  connectEventStream(options = {}) {
    if (this._destroyed || this.eventSource) return;
    if (!this.sessionId) return;

    const apiBaseUrl = this.sessionApiBaseUrl || this.baseUrl;
    const fromSeq =
      options.fromSequenceNum !== undefined
        ? options.fromSequenceNum
        : this.lastSequenceNum;

    const streamUrl = buildEventStreamUrl(apiBaseUrl, this.sessionId, fromSeq);
    const controller = new AbortController();
    const connection = { close: () => controller.abort() };
    this.eventSource = connection;

    const handleDisconnect = (reconnect) => {
      if (controller.signal.aborted) return;
      this.eventSource = null;
      if (
        reconnect &&
        this.eventStreamReconnects < EVENT_STREAM_MAX_RECONNECTS &&
        !this._destroyed
      ) {
        this.eventStreamReconnects++;
        setTimeout(() => {
          if (!this._destroyed) this.connectEventStream({ fromSequenceNum: this.lastSequenceNum });
        }, EVENT_STREAM_RECONNECT_DELAY_MS * this.eventStreamReconnects);
      }
    };

    (async () => {
      try {
        const headers = {
          Accept: "text/event-stream",
          "anthropic-version": "2023-06-01",
        };
        const token = this.sessionToken || this.environmentSecret || this.token;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (fromSeq > 0) headers["Last-Event-ID"] = String(fromSeq);

        const res = await fetch(streamUrl, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          handleDisconnect(true);
          return;
        }
        if (!res.body) {
          handleDisconnect(true);
          return;
        }

        this.eventStreamReconnects = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (controller.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, remaining } = parseSSEFrames(buffer);
          buffer = remaining;

          for (const frame of frames) {
            if (frame.id) {
              const seq = parseInt(frame.id, 10);
              if (!Number.isNaN(seq) && seq > this.lastSequenceNum) {
                this.lastSequenceNum = seq;
              }
            }
            if (frame.event === CLIENT_EVENT_TYPE && frame.data) {
              try {
                const ev = JSON.parse(frame.data);
                this.onEvent?.(ev);
                const payload = ev.payload;
                if (payload?.type === "user_message" || payload?.message) {
                  const msg = payload.message || { role: "user", content: payload.content };
                  if (msg.role === "user" && msg.content) {
                    this.pendingMessages.push(msg);
                    this.onInboundMessage?.(msg);
                  }
                }
              } catch (e) {
                safeLog("Uplift event-stream parse error:", e.message);
              }
            }
          }
        }

        reader.releaseLock();
        handleDisconnect(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        safeLog("Uplift event-stream error:", error.message);
        handleDisconnect(true);
      }
    })();
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async send(text, onChunk, signal) {
    if (!this.sessionId || !this.sessionToken) {
      throw new Error("No active session - check connection");
    }

    // Session-authenticated calls go to the api_base_url from the work secret
    // when one is provided, else the registered bridge host.
    const apiBase = this.sessionApiBaseUrl || this.baseUrl;

    // POST assistant message as a session event to the bridge
    const response = await this._fetch(
      `${apiBase}/v1/sessions/${this.sessionId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({
          type: "message",
          role: "assistant",
          content: text,
        }),
      },
      signal
    );

    if (!response.ok) {
      throw new Error(`Bridge send failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      // Stream SSE chunks from the bridge response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      outer: while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, remaining } = parseSSEFrames(buffer);
        buffer = remaining;
        for (const frame of frames) {
          if (frame.id) {
            const seq = parseInt(frame.id, 10);
            if (!Number.isNaN(seq) && seq > this.lastSequenceNum) {
              this.lastSequenceNum = seq;
            }
          }
          if (!frame.data) continue;
          const data = frame.data.trim();
          if (data === "[DONE]") break outer;
          try {
            const parsed = JSON.parse(data);
            const delta =
              parsed.choices?.[0]?.delta?.content ?? parsed.text ?? "";
            if (delta) {
              fullText += delta;
              onChunk?.(delta);
            }
          } catch {
            if (data) {
              fullText += data;
              onChunk?.(data);
            }
          }
        }
      }

      return fullText;
    }

    // Non-streaming response: emit full content as a single chunk
    const data = await response.json().catch(() => null);
    const responseText = data?.content ?? data?.message ?? "";
    if (responseText) onChunk?.(responseText);
    return responseText;
  }

  async _fetch(path, options = {}, externalSignal = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    // Forward external abort (e.g. user-initiated interrupt) to our controller
    let externalHandler;
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeout);
        controller.abort();
      } else {
        externalHandler = () => controller.abort();
        externalSignal.addEventListener("abort", externalHandler, { once: true });
      }
    }

    try {
      // `path` is usually a relative API path, but session-authenticated calls
      // may carry the api_base_url from the work secret (absolute). Detect and
      // use as-is to avoid double-concatenating.
      const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "anthropic-version": "2023-06-01",
          ...options.headers,
        },
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeout);
      if (externalSignal && externalHandler) {
        externalSignal.removeEventListener("abort", externalHandler);
      }
    }
  }

  disconnect() {
    this._destroyed = true;
    this.polling = false;

    this._stopHeartbeat();

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Deregister environment if we have one
    if (this.environmentId) {
      this._fetch(`/v1/environments/bridge/${this.environmentId}`, {
        method: "DELETE",
      }).catch(() => {
        // Ignore errors on cleanup
      });
    }

    this.environmentId = null;
    this.environmentSecret = null;
    this.sessionId = null;
    this.sessionToken = null;
    this.sessionApiBaseUrl = null;
    this.activeWorkId = null;
    this.lastSequenceNum = 0;
  }
}

/**
 * Health check for Uplift Bridge
 */
export async function upliftBridgeHealthCheck(host, port, token, timeoutMs = 3000) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const url = `${baseUrl}/v1/health`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok;
  } catch (e) {
    clearTimeout(timeout);
    return false;
  }
}

/**
 * Build the session ingress event-stream URL for a session.
 * `<apiBase>/v2/session_ingress/session/<id>/events/stream` on localhost,
 * `/v1/...` on remote hosts (Envoy rewrites v1 -> v2).
 */
export function buildEventStreamUrl(apiBaseUrl, sessionId, fromSequenceNum = 0) {
  const isLocalhost =
    apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  const version = isLocalhost ? "v2" : "v1";
  const base = apiBaseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/${version}/session_ingress/session/${sessionId}/events/stream`
  );
  if (fromSequenceNum > 0) {
    url.searchParams.set("from_sequence_num", String(fromSequenceNum));
  }
  return url.href;
}
