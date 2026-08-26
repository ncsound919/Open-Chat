/**
 * GeminiNotebookClient - talks to the AgentBrowser Gemini Notebook Bridge
 * (POST http://host:port/api/notebook, X-Agent-Auth token).
 * JSON request/response, no SSE streaming needed (artifact work is async).
 */

const CONNECT_TIMEOUT_MS = 60_000;

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number|string} opts.port
 * @param {string} opts.token
 * @param {string} opts.action  e.g. "notebook.query"
 * @param {object} [opts.body]  extra fields (question, sources, account, ...)
 * @returns {Promise<{ok:boolean, data?:any, error?:string, needsLogin?:boolean}>}
 */
export async function notebookRequest({ host, port, token, action, body = {} }) {
  const baseUrl = /^https?:\/\//i.test(String(host || ""))
    ? String(host).replace(/\/$/, "")
    : `http://${host}:${port || 3700}`;
  const url = `${baseUrl}/api/notebook`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
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
    return payload || { ok: true, data: null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}