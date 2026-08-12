/**
 * Hermes agent HTTP/SSE client
 *
 * Talks to the real hermes-agent gateway (hermes-agent-main, OpenAI-compatible
 * API server on :8642):
 *   - POST /v1/chat/completions            — OpenAI Chat Completions (SSE)
 *   - GET  /v1/capabilities                — agent identity / API surface
 *   - GET  /v1/models                      — model + alias inventory
 *   - GET  /v1/skills                      — installed skill listing
 *   - GET  /health                         — simple health (no auth)
 *   - GET  /health/detailed                — rich status (Bearer auth)
 *
 * Session continuity is opt-in per conversation: send an X-Hermes-Session-Id
 * header so the gateway keeps a stable memory for that chat, and read the
 * echoed X-Hermes-Session-Id from the response headers. Long-term memory can
 * additionally be scoped via X-Hermes-Session-Key.
 *
 * Tool calls are streamed as `event: hermes.tool.progress` SSE frames with
 * { tool, emoji, label, toolCallId, status: running|completed } payloads so
 * the chat UI can render live tool-call cards.
 */

import { resolveEndpoint } from "../utils/security.js";

/** Connection timeout in milliseconds for the initial HTTP request. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Stream a chat completion from the Hermes gateway.
 *
 * @param {string} host
 * @param {string|number} port
 * @param {string} token
 * @param {Array<{role: string, content: string}>} messages
 * @param {(delta: string) => void} onChunk
 * @param {AbortSignal} [signal]
 * @param {string} [model]
 * @param {Object} [opts]
 * @param {string} [opts.sessionId]        — X-Hermes-Session-Id for memory continuity
 * @param {(call: Object) => void} [opts.onToolCall] — hermes.tool.progress events
 * @param {(sessionId: string|null) => void} [opts.onSessionId] — echoed header
 * @param {(usage: Object) => void} [opts.onUsage]      — final chunk token usage
 * @returns {Promise<string>} The full assistant text.
 */
export async function hermesStream(
  host,
  port,
  token,
  messages,
  onChunk,
  signal,
  model,
  opts = {}
) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const url = `${baseUrl}/v1/chat/completions`;

  // Combine caller's abort signal with a connection timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), CONNECT_TIMEOUT_MS);

  // Merge external signal (stop button) with the timeout signal
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

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (opts.sessionId) headers["X-Hermes-Session-Id"] = opts.sessionId;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: combinedSignal,
      headers,
      body: JSON.stringify({
        model: model || "hermes-agent",
        messages,
        stream: true,
        metadata: {
          ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
        },
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // Echoed session id (if the gateway assigned/normalized one) + usage are
  // only available after the response headers / final chunk arrive.
  opts.onSessionId?.(res.headers.get("X-Hermes-Session-Id"));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  let eventDataLines = [];

  const processEventData = () => {
    if (eventDataLines.length === 0) return false;

    const data = eventDataLines.join("\n").trim();
    eventDataLines = [];

    if (!data) return false;
    if (data === "[DONE]") {
      return true;
    }

    try {
      const parsed = JSON.parse(data);

      // hermes.tool.progress events carry { tool, emoji, label, toolCallId, status }.
      if (parsed && typeof parsed.tool === "string") {
        opts.onToolCall?.(parsed);
        return false;
      }

      const delta = parsed.choices?.[0]?.delta?.content || "";

      if (delta) {
        fullText += delta;
        onChunk(delta);
      }

      if (parsed.usage) {
        opts.onUsage?.(parsed.usage);
      }
    } catch (e) {
      // Ignore parse errors in complete SSE events
      console.warn("Failed to parse SSE data:", e);
    }

    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line === "") {
        if (processEventData()) {
          return fullText;
        }
        continue;
      }

      if (line.startsWith("data:")) {
        const data = line.slice(5).replace(/^\s/, "");
        eventDataLines.push(data);
      }
    }
  }

  buffer += decoder.decode();
  const trailingLines = buffer.split(/\r?\n/);

  for (const line of trailingLines) {
    if (line === "") {
      if (processEventData()) {
        return fullText;
      }
      continue;
    }

    if (line.startsWith("data:")) {
      const data = line.slice(5).replace(/^\s/, "");
      eventDataLines.push(data);
    }
  }

  if (processEventData()) {
    return fullText;
  }
  return fullText;
}

/**
 * Health check against the real Hermes gateway.
 *
 * The gateway serves GET /health (no auth); the legacy JS proxy served
 * /v1/health. Probe both so either backend is recognized.
 */
export async function hermesHealthCheck(host, port, token, timeoutMs = 3000) {
  const baseUrl = resolveEndpoint(host, port, "http");

  const probe = async (path) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (await probe("/health")) return true;
  return probe("/v1/health");
}

/**
 * GET /health — simple gateway health { status, platform, version }.
 */
export async function hermesHealth(host, port, token, timeoutMs = 4000) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /health/detailed — rich status for dashboard probing: readiness,
 * gateway_state, connected platforms, active agents, busy/drainable, PID.
 * Falls back to /health when detailed is unavailable (legacy proxy).
 */
export async function hermesHealthDetailed(host, port, token, timeoutMs = 4000) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health/detailed`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /v1/capabilities — agent identity + machine-readable API surface:
 * platform, model, auth, runtime mode, feature flags, endpoint map.
 */
export async function hermesAgentInfo(host, port, token, timeoutMs = 4000) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/capabilities`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /v1/models — model + configured alias inventory.
 * Returns the data array of model objects.
 */
export async function hermesModels(host, port, token, timeoutMs = 4000) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.data) ? data.data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /v1/skills — installed skill listing for the API-server agent.
 * Returns the skills array.
 */
export async function hermesSkills(host, port, token, timeoutMs = 4000) {
  const baseUrl = resolveEndpoint(host, port, "http");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/skills`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.skills) ? data.skills : Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
