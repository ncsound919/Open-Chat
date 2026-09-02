/**
 * Uplift Bridge Protocol — wire contract helpers
 *
 * Clean-room implementation of the bridge protocol used by the Uplift bridge
 * worker and the environments API. Shared by the Open-Chat client and the
 * Draymond bridge server so both sides agree on work-secret encoding, SSE
 * framing, session-id comparison, and ingress URL construction.
 *
 * All functions are pure and dependency-free (no fetch, no axios) so they are
 * unit-testable in isolation.
 */

/** base64url -> UTF-8 string (RFC 4648 §5, no padding required on input). */
export function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** UTF-8 string -> base64url (no padding). */
export function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url-encoded work secret and validate its shape.
 * The secret carries the session ingress token the worker must use to talk to
 * the session ingress API (ack/heartbeat/events). Throws on unsupported
 * version or missing fields.
 *
 * @param {string} secret base64url-encoded JSON
 * @returns {{
 *   version: number,
 *   session_ingress_token: string,
 *   api_base_url: string,
 *   sources?: Array<object>,
 *   auth?: Array<object>,
 *   environment_variables?: Record<string, string> | null,
 * }}
 */
export function decodeWorkSecret(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Invalid work secret: missing secret");
  }
  let parsed;
  try {
    parsed = JSON.parse(base64UrlDecode(secret));
  } catch (e) {
    throw new Error(`Invalid work secret: not valid base64url JSON (${e.message})`);
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
    const v = parsed && typeof parsed === "object" ? parsed.version : "unknown";
    throw new Error(`Unsupported work secret version: ${v}`);
  }
  if (typeof parsed.session_ingress_token !== "string" || !parsed.session_ingress_token) {
    throw new Error("Invalid work secret: missing or empty session_ingress_token");
  }
  if (typeof parsed.api_base_url !== "string") {
    throw new Error("Invalid work secret: missing api_base_url");
  }
  return parsed;
}

/**
 * Encode a work secret object as base64url JSON (server side).
 * @param {object} secret
 * @returns {string}
 */
export function encodeWorkSecret(secret) {
  return base64UrlEncode(JSON.stringify(secret));
}

/**
 * Compare two session IDs regardless of their tagged-ID prefix.
 *
 * Tagged IDs have the form `{tag}_{body}` or `{tag}_staging_{body}`. The
 * compat layer returns `session_*` to v1 clients while the infrastructure
 * layer uses `cse_*`; both share the same underlying UUID. Without this
 * normalization, a worker rejects its own session as "foreign".
 */
export function sameSessionId(a, b) {
  if (a === b) return true;
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBody = a.slice(a.lastIndexOf("_") + 1);
  const bBody = b.slice(b.lastIndexOf("_") + 1);
  return aBody.length >= 4 && aBody === bBody;
}

/**
 * Build a WebSocket SDK URL from the API base URL and session ID.
 * Uses /v2/ for localhost (direct to session ingress) and /v1/ for remote
 * hosts (Envoy rewrites /v1/ -> /v2/), matching the bridge worker contract.
 *
 * @param {string} apiBaseUrl e.g. "http://127.0.0.1:8642"
 * @param {string} sessionId
 * @returns {string} ws(s)://host/<v1|v2>/session_ingress/ws/<sessionId>
 */
export function buildSdkUrl(apiBaseUrl, sessionId) {
  const isLocalhost =
    apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  const protocol = isLocalhost ? "ws" : "wss";
  const version = isLocalhost ? "v2" : "v1";
  const host = apiBaseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`;
}

/**
 * Build a CCR v2 session URL (HTTP) used for /worker/register and the SSE
 * event stream. Unlike buildSdkUrl this returns an HTTP(S) URL pointing at
 * /v1/code/sessions/{id}.
 *
 * @param {string} apiBaseUrl
 * @param {string} sessionId
 * @returns {string}
 */
export function buildCCRv2SdkUrl(apiBaseUrl, sessionId) {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return `${base}/v1/code/sessions/${sessionId}`;
}

/**
 * Convert an SSE stream URL to its HTTP POST counterpart.
 * The stream endpoint is `<base>/.../events/stream`; writes go to
 * `<base>/.../events` (drop the trailing /stream).
 *
 * @param {URL|string} sseUrl
 * @returns {string}
 */
export function convertSSEUrlToPostUrl(sseUrl) {
  const url = typeof sseUrl === "string" ? new URL(sseUrl) : sseUrl;
  let pathname = url.pathname;
  if (pathname.endsWith("/stream")) {
    pathname = pathname.slice(0, -"/stream".length);
  }
  return `${url.protocol}//${url.host}${pathname}`;
}

/**
 * Incrementally parse SSE frames from a text buffer.
 * Frames are delimited by double newlines. Returns the parsed frames plus the
 * remaining (incomplete) buffer for the next call.
 *
 * @param {string} buffer
 * @returns {{ frames: Array<{event?: string, id?: string, data?: string}>, remaining: string }}
 */
export function parseSSEFrames(buffer) {
  const frames = [];
  let pos = 0;

  // Normalize CRLF/CR so streams that use \r\n (the SSE spec's recommended
  // line ending) are parsed identically to \n-only streams.
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let idx;
  while ((idx = normalized.indexOf("\n\n", pos)) !== -1) {
    const rawFrame = normalized.slice(pos, idx);
    pos = idx + 2;

    if (!rawFrame.trim()) continue;

    const frame = {};
    let isComment = false;

    for (const line of rawFrame.split("\n")) {
      if (line.startsWith(":")) {
        isComment = true;
        continue;
      }
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx);
      const value =
        line[colonIdx + 1] === " "
          ? line.slice(colonIdx + 2)
          : line.slice(colonIdx + 1);
      switch (field) {
        case "event":
          frame.event = value;
          break;
        case "id":
          frame.id = value;
          break;
        case "data":
          frame.data = frame.data ? frame.data + "\n" + value : value;
          break;
        default:
          break;
      }
    }

    if (frame.data || isComment) {
      frames.push(frame);
    }
  }

  return { frames, remaining: normalized.slice(pos) };
}

/** The only event type worker subscribers receive on the CCR v2 stream. */
export const CLIENT_EVENT_TYPE = "client_event";
