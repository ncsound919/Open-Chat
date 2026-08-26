/**
 * GeminiNotebookClient - talks to the AgentBrowser Gemini Notebook Bridge
 * (POST http(s)://host:port/api/notebook, X-Agent-Auth token).
 * JSON request/response, no SSE streaming needed (artifact work is async).
 */

import { resolveEndpoint } from "../utils/security.js";

// Connection timeout for the initial HTTP request. Long driver operations
// (e.g. artifact export) can take up to 60s and may time out here.
const CONNECT_TIMEOUT_MS = 45_000;

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number|string} opts.port
 * @param {string} opts.token
 * @param {string} opts.action  e.g. "notebook.query"
 * @param {object} [opts.body]  extra fields (question, sources, account, ...)
 * @param {AbortSignal} [opts.signal]  external abort signal (Stop button)
 * @returns {Promise<{ok:boolean, data?:any, error?:string, needsLogin?:boolean}>}
 */
export async function notebookRequest({ host, port, token, action, body = {}, signal }) {
  const trimmedHost = String(host || "").trim();
  if (!trimmedHost) {
    return { ok: false, error: "bridge host not configured" };
  }
  const baseUrl = resolveEndpoint(trimmedHost, port, "http");
  const url = `${baseUrl}/api/notebook`;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), CONNECT_TIMEOUT_MS);

  // Merge the caller's abort signal (stop button) with the timeout signal.
  const combinedSignal = signal
    ? AbortSignal.any
      ? AbortSignal.any([signal, timeoutController.signal])
      : (() => {
          const merged = new AbortController();
          signal.addEventListener("abort", () => merged.abort());
          timeoutController.signal.addEventListener("abort", () => merged.abort());
          return merged.signal;
        })()
    : timeoutController.signal;

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: combinedSignal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Agent-Auth": token } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: payload?.error
          ? `HTTP ${res.status}: ${payload.error}`
          : `HTTP ${res.status}: ${res.statusText}`,
      };
    }
    if (!payload) {
      return { ok: false, error: `HTTP ${res.status}: non-JSON response` };
    }
    return payload;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}