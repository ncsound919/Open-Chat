/**
 * Security utilities for Open-Chat
 * Provides input sanitization, validation, and safe logging helpers
 */

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

const DANGEROUS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script\s*>/gi,
  /<[^>]+\s+on\w+\s*=[\s\S]*?>/gi, // inline event handlers
  /javascript\s*:/gi,
  /(?:href|src)\s*=\s*["']?\s*data\s*:/gi,
];

/** Maximum allowed WebSocket / SSE message size in bytes (1 MB) */
export const MAX_MESSAGE_BYTES = 1_048_576;

/**
 * Sanitize user-supplied or model-generated text.
 * Strips <script> blocks and inline event-handler attributes so the string
 * can be passed to a markdown renderer without enabling XSS.
 */
export function sanitizeText(input) {
  if (typeof input !== "string") return "";
  let out = input;
  for (const pattern of DANGEROUS_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out;
}

/**
 * Return true when `host` resolves to the local machine only.
 * Warn consumers if they attempt to connect to a remote host.
 */
export function isLocalhost(host) {
  if (!host || typeof host !== "string") return false;
  return LOCALHOST_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Return true when `url` uses an allow-listed protocol.
 * Blocks javascript:, data:, file:, and other dangerous schemes.
 */
export function isSafeUrl(url) {
  try {
    const { protocol } = new URL(url);
    return SAFE_URL_PROTOCOLS.has(protocol);
  } catch {
    return false;
  }
}

/**
 * Build a base endpoint URL for an agent server, preferring secure schemes
 * for any host that is not local. This prevents bearer tokens from being
 * sent in cleartext over the network to remote/LAN hosts.
 *
 * Supports three forms:
 *   1. Full URL      — "https://tunnel.example.com" → used as-is
 *   2. Local host    — "127.0.0.1" + port          → http:///ws://host:port
 *   3. Remote host   — "agents.example.com" + port → https:///wss://host[:port]
 *
 * @param {string} host
 * @param {string|number} [port]
 * @param {'http'|'ws'} [kind='http']  Protocol family to emit.
 * @returns {string}
 */
export function resolveEndpoint(host, port, kind = "http") {
  const trimmed = String(host || "").trim();
  const secure = kind === "ws" ? "wss" : "https";
  const insecure = kind === "ws" ? "ws" : "http";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, "");
  }
  if (isLocalhost(trimmed)) {
    const p = port ? `:${port}` : "";
    return `${insecure}://${trimmed}${p}`;
  }
  const p = port ? `:${port}` : "";
  return `${secure}://${trimmed}${p}`;
}

/**
 * Mask a token so only the last 4 characters are visible.
 * Returns an empty string if the token is blank.
 *
 * @example maskToken("secret_key_12345") // "•••••2345"
 */
export function maskToken(token) {
  if (!token || typeof token !== "string" || token.trim() === "") return "";
  if (token.length <= 4) return "•".repeat(token.length);
  return "•".repeat(token.length - 4) + token.slice(-4);
}

/**
 * Check whether a raw message payload is within the allowed size.
 *
 * @param {string} data  The raw string received over the wire.
 * @param {number} [maxBytes=MAX_MESSAGE_BYTES]
 * @returns {boolean}
 */
export function isValidMessageSize(data, maxBytes = MAX_MESSAGE_BYTES) {
  if (typeof data !== "string") return false;
  // TextEncoder gives exact UTF-8 byte length
  return new TextEncoder().encode(data).length <= maxBytes;
}

/**
 * Log an error to the console while redacting any value that looks like a
 * bearer token, password, or API key from the message and stack trace.
 *
 * @param {string} label  Human-readable context label.
 * @param {unknown} [err] The error or value to log.
 */
export function safeLog(label, err) {
  const redact = (str) =>
    String(str)
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/token[=:\s]+\S+/gi, "token=[REDACTED]")
      .replace(/key[=:\s]+\S+/gi, "key=[REDACTED]")
      .replace(/password[=:\s]+\S+/gi, "password=[REDACTED]");

  if (err instanceof Error) {
    console.error(`[OpenChat] ${label}:`, redact(err.message));
  } else {
    console.error(`[OpenChat] ${label}:`, redact(String(err ?? "")));
  }
}
