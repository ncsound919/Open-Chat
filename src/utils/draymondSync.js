/**
 * draymondSync — deep integration helpers: push private on-device chat
 * exchanges into the Draymond orchestrator's message store so the fleet
 * can reference them, and report the phone's local-model capability.
 */

const SYNC_TIMEOUT_MS = 15_000;

/**
 * Post a batch of messages to Draymond's chat-history store.
 * @param {object} opts
 * @param {string} opts.baseUrl - Draymond base URL, e.g. "http://host:3444/api"
 * @param {string} opts.token - Bearer token (CRON_SECRET)
 * @param {string} opts.sessionId
 * @param {Array<{role:string,content:string}>} opts.messages
 * @returns {Promise<{ok:boolean,error?:string,count?:number}>}
 */
export async function syncMessagesToDraymond({ baseUrl, token, sessionId, messages }) {
  if (!baseUrl || !messages?.length) {
    return { ok: false, error: "baseUrl and messages required" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        session_id: sessionId,
        messages: messages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: String(m.content ?? ""),
          metadata: { source: "open-chat-local", synced_at: new Date().toISOString() },
        })),
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: `Draymond sync failed: HTTP ${res.status}`, status: res.status };
    }
    return { ok: data?.ok !== false, count: messages.length };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "Draymond sync timed out" : `Draymond sync failed: ${err?.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a serializable exchange (user + assistant) from a local bot's
 * message history for the last assistant message.
 * @param {Array} messages - local bot history
 * @returns {Array<{role:string,content:string}>}
 */
export function lastLocalExchange(messages = []) {
  const out = [];
  for (let i = messages.length - 1; i >= 0 && out.length < 2; i--) {
    const m = messages[i];
    if (m?.role === "assistant" || m?.role === "user") {
      out.unshift({ role: m.role, content: String(m.text ?? "") });
    }
  }
  return out;
}
