/**
 * Hermes HTTP/SSE streaming client
 * OpenAI-compatible API with Server-Sent Events
 */
export async function hermesStream(host, port, token, messages, onChunk, signal) {
  const url = `http://${host}:${port}/v1/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model: "hermes-agent",
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });

    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;

      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        return fullText;
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";

        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      } catch (e) {
        // Ignore parse errors in streaming data
        console.warn("Failed to parse SSE data:", e);
      }
    }
  }

  return fullText;
}

/**
 * Check Hermes health endpoint
 */
export async function hermesHealthCheck(host, port, token, timeoutMs = 3000) {
  const url = `http://${host}:${port}/v1/health`;

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
