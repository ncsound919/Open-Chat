/**
 * ntfy Protocol Client
 * Subscribes to ntfy topics (push notification server) and renders
 * HTTP action buttons in chat. Used by the Draymond approval relay.
 *
 * Transport:
 *  - Subscribe: NDJSON stream at GET /{topic}/json
 *      One JSON object per line. Keepalives are empty objects {}.
 *  - Publish:   POST JSON to the server ROOT URL (not /{topic})
 *      Body carries the topic; supports title, message, priority,
 *      tags and up to 3 actions.
 *
 * The consumer is responsible for de-duplicating messages by their
 * ntfy `id` (the stream does not guarantee exactly-once delivery).
 */

import { isSafeUrl } from "../utils/security.js";

/** Reconnect delay after an unexpected stream close (ms) */
const RECONNECT_DELAY_MS = 3_000;

/** First-connect lookback when no last message id is known (ms) */
const INITIAL_SINCE_MS = 24 * 60 * 60 * 1000;

/** Maximum accepted JSON line size (1 MB) */
const MAX_LINE_BYTES = 1_048_576;

/** Base URL resolution — host may be a full URL, a remote hostname, or local. */
function resolveBaseUrl(host, port) {
  const trimmed = String(host || "").trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, "");
  }
  const lower = trimmed.toLowerCase();
  const isLocal =
    lower === "" || lower === "127.0.0.1" || lower === "localhost" || lower === "::1";
  if (isLocal) {
    return `http://${trimmed || "127.0.0.1"}:${port || "80"}`;
  }
  return `https://${trimmed}${port ? `:${port}` : ""}`;
}

/**
 * ntfy Protocol Client
 */
export class NtfyClient {
  constructor(host, port, token, topic) {
    this.baseUrl = resolveBaseUrl(host, port);
    this.token = token;
    this.topic = String(topic || "").trim();

    // Callbacks
    this.onStatusChange = null;
    this.onMessage = null;

    // State
    this.status = "disconnected";
    this._reader = null;
    this._controller = null;
    this._reconnectTimerId = null;
    this._shouldReconnect = false;
    this._lastMessageId = null;
  }

  /**
   * Connect and start consuming the NDJSON message stream.
   * Resolves when the initial HTTP response is received (stream stays open).
   */
  async connect() {
    if (!this.topic) {
      throw new Error("ntfy topic is required");
    }

    this._setStatus("connecting");

    // Close any previous stream
    this._closeStream();

    this._shouldReconnect = true;
    const since =
      this._lastMessageId != null
        ? String(this._lastMessageId)
        : `${INITIAL_SINCE_MS}ms`;

    const url = `${this.baseUrl}/${encodeURIComponent(this.topic)}/json?since=${since}`;
    this._controller = new AbortController();

    const headers = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(url, {
        headers,
        signal: this._controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error("Stream body not available");
      }

      this._setStatus("connected");

      // Consume in the background; reconnect on unexpected close
      this._consumeStream(res.body, this._controller.signal).catch(() => {
        this._handleStreamClosed();
      });
    } catch (err) {
      if (this._controller.signal.aborted) return;
      this._setStatus("error");
      this._scheduleReconnect();
      throw err;
    }
  }

  /**
   * Disconnect cleanly and stop reconnecting.
   */
  disconnect() {
    this._shouldReconnect = false;
    if (this._reconnectTimerId !== null) {
      clearTimeout(this._reconnectTimerId);
      this._reconnectTimerId = null;
    }
    this._closeStream();
    this._setStatus("disconnected");
  }

  /**
   * Publish a message (with optional actions) to the configured topic.
   * POSTs to the server root — the topic lives in the JSON body.
   * @returns {Promise<boolean>} true when the server accepted the publish
   */
  async publish({ title, message, priority, tags, actions } = {}) {
    if (!this.topic) return false;

    const payload = { topic: this.topic };
    if (title != null) payload.title = String(title);
    if (message != null) payload.message = String(message);
    if (priority != null) payload.priority = Number(priority);
    if (Array.isArray(tags)) payload.tags = tags;
    if (Array.isArray(actions) && actions.length > 0) {
      payload.actions = actions.slice(0, 3);
    }

    try {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch (err) {
      console.warn("[ntfy] publish failed:", err);
      return false;
    }
  }

  /**
   * Execute a single ntfy action button:
   *   - view:      open URL in new tab
   *   - http:      POST/GET the URL with optional headers + body
   *   - copy:      copy the action label / clipboard string
   *   - broadcast: echo the label as an in-app message (no publish — ntfy
   *                message ids are internal, so we don't forward to the server)
   * @param {object} action  The ntfy action object from the message
   * @returns {Promise<object>} Result description for UI feedback
   */
  async executeAction(action) {
    if (!action || typeof action !== "object") {
      return { ok: false, error: "Invalid action" };
    }

    switch (action.action) {
      case "view":
        return this._viewAction(action);
      case "http":
        return this._httpAction(action);
      case "copy":
        return this._copyAction(action);
      case "broadcast":
        return { ok: true, output: String(action.label || "") };
      default:
        return { ok: false, error: `Unsupported action: ${action.action}` };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Consume an NDJSON line-delimited stream. */
  async _consumeStream(body, signal) {
    this._reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await this._reader.read();
        if (done) break;
        if (signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_LINE_BYTES) {
          buffer = buffer.slice(-MAX_LINE_BYTES);
        }

        // NDJSON: one JSON object per line
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          this._handleLine(line);
        }
      }
    } finally {
      this._reader.releaseLock();
      this._reader = null;
    }
  }

  /** Parse a single NDJSON line. Keepalives are `{}` and are ignored. */
  _handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn("[ntfy] Skipped malformed line");
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    // Keepalive objects have no `event` field — ignore them
    if (parsed.event !== "message" || !parsed.id) return;

    this._lastMessageId = parsed.id;
    this.onMessage?.(parsed);
  }

  /** Acknowledge an unexpected stream close and schedule a reconnect. */
  _handleStreamClosed() {
    if (this._controller?.signal.aborted) return;
    this._setStatus("disconnected");
    this._scheduleReconnect();
  }

  /** Schedule a single reconnect attempt (no exponential backoff). */
  _scheduleReconnect() {
    if (!this._shouldReconnect || this._reconnectTimerId !== null) return;
    this._reconnectTimerId = setTimeout(() => {
      this._reconnectTimerId = null;
      if (!this._shouldReconnect) return;
      this.connect().catch(() => {});
    }, RECONNECT_DELAY_MS);
  }

  /** Close the underlying stream + abort controller. */
  _closeStream() {
    if (this._reader) {
      this._reader.cancel().catch(() => {});
      this._reader = null;
    }
    if (this._controller) {
      this._controller.abort();
      this._controller = null;
    }
  }

  /** Open a URL in a new tab (view action). */
  _viewAction(action) {
    const url = String(action.url || "").trim();
    if (!isSafeUrl(url)) {
      return { ok: false, error: "Blocked unsafe URL" };
    }
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return { ok: true, output: `Opened ${url}` };
  }

  /** Perform an HTTP action (approve/reject callbacks). */
  async _httpAction(action) {
    const url = String(action.url || "").trim();
    if (!isSafeUrl(url)) {
      return { ok: false, error: "Blocked unsafe URL" };
    }

    const method = String(action.method || "GET").toUpperCase();

    const headers = { ...(action.headers || {}) };
    let body;
    if (typeof action.body === "string" && action.body.length > 0) {
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      body = action.body;
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const json = await res.json();
          if (json?.error) detail = `${detail}: ${json.error}`;
        } catch {
          // Non-JSON error body — ignore
        }
        return { ok: false, error: detail };
      }

      let output = "Request succeeded";
      try {
        const json = await res.json();
        if (json?.action?.status) {
          output = `Status: ${json.action.status}`;
        } else if (json?.message) {
          output = String(json.message);
        }
      } catch {
        // No JSON body — keep default output
      }
      return { ok: true, output };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
    }
  }

  /** Copy a value to the clipboard (copy action). */
  async _copyAction(action) {
    const value = String(action.clipboard ?? action.label ?? "").trim();
    if (!value) return { ok: false, error: "Nothing to copy" };
    try {
      await navigator.clipboard.writeText(value);
      return { ok: true, output: "Copied to clipboard" };
    } catch {
      return { ok: false, error: "Clipboard unavailable" };
    }
  }

  _setStatus(status) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
