/**
 * Sub-Team / Draymond Protocol Client
 * Connects to Sub-Team CPU design agent via HTTP wrapper
 *
 * Architecture: Expects a simple HTTP/SSE endpoint that wraps Sub-Team's Python API
 * - POST /v1/chat/completions with Hermes-compatible format
 * - Streaming responses via Server-Sent Events
 * - Tool invocation based on user intent (e.g., "design a CPU", "verify RTL")
 *
 * Sub-Team Tools (from README):
 * - sub_team_run: Full four-agent pipeline end-to-end
 * - sub_team_spec: SpecificationAgent only
 * - sub_team_microarch: MicroarchitectureAgent only
 * - sub_team_implement: ImplementationAgent only
 * - sub_team_verify: VerificationAgent only
 */

import { resolveEndpoint } from "../utils/security.js";

/** Connection timeout in milliseconds for the initial HTTP request. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Stream messages to Sub-Team agent
 * Uses Hermes-compatible OpenAI format
 */
export async function subTeamStream(host, port, token, messages, onChunk, signal) {
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

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: combinedSignal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        model: "subteam-agent",
        messages,
        stream: true,
        // Sub-Team specific metadata
        metadata: {
          agent_type: "cpu_design",
          draymond_registered: true,
        },
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

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
      const delta = parsed.choices?.[0]?.delta?.content || "";

      if (delta) {
        fullText += delta;
        onChunk(delta);
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
 * Check Sub-Team health endpoint
 */
export async function subTeamHealthCheck(host, port, token, timeoutMs = 3000) {
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
