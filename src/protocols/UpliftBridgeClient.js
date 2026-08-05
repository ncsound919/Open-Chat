/**
 * Uplift Bridge Protocol Client
 * Connects to Uplift Agent via its Bridge API for remote session control
 *
 * Architecture: Uplift uses a polling-based bridge with session management
 * - Register environment to get environment_id and session_token
 * - Poll for work messages
 * - Send responses via session events
 * - Simulate streaming by chunking responses
 */

import { safeLog, resolveEndpoint } from "../utils/security.js";

/** Polling interval for checking new messages */
const POLL_INTERVAL_MS = 2000;

/** Connection timeout */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Uplift Bridge client
 * Handles OAuth, environment registration, and message polling
 */
export class UpliftBridgeClient {
  constructor(host, port, token) {
    this.baseUrl = resolveEndpoint(host, port, "http");
    this.token = token; // OAuth access token
    this.environmentId = null;
    this.environmentSecret = null;
    this.sessionId = null;
    this.sessionToken = null;
    this.polling = false;
    this.pollTimer = null;
    this.onStatusChange = null;
    this.onInboundMessage = null;
    this._destroyed = false;
    this.pendingMessages = [];
  }

  async connect() {
    if (this._destroyed) {
      throw new Error("Client destroyed");
    }

    try {
      this.onStatusChange?.("connecting");

      // Register bridge environment
      const regResponse = await this._fetch("/v1/environments/bridge", {
        method: "POST",
        body: JSON.stringify({
          machine_name: "open-chat-client",
          directory: "/",
          branch: "main",
          git_repo_url: "",
          max_sessions: 1,
          metadata: { worker_type: "chat" },
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
          // Got work - this is an incoming message or session event
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
    // Extract session info if this is a new session
    if (work.data.type === "session_start") {
      this.sessionId = work.data.id;
      this.sessionToken = work.data.session_token;
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

  async send(text, onChunk, signal) {
    if (!this.sessionId || !this.sessionToken) {
      throw new Error("No active session - check connection");
    }

    // POST assistant message as a session event to the bridge
    const response = await this._fetch(
      `/v1/sessions/${this.sessionId}/events`,
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

      outer: while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value, { stream: true });
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
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
      const response = await fetch(`${this.baseUrl}${path}`, {
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

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
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
