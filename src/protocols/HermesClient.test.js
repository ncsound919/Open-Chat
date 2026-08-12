import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hermesStream,
  hermesHealthCheck,
  hermesHealth,
  hermesHealthDetailed,
  hermesAgentInfo,
  hermesModels,
  hermesSkills,
} from "./HermesClient.js";

const encoder = new TextEncoder();

function streamFromChunks(chunks) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) return { value: encoder.encode(chunks[i++]), done: false };
        return { value: undefined, done: true };
      },
      releaseLock: vi.fn(),
      cancel: vi.fn().mockResolvedValue(),
    }),
  };
}

function jsonOk(payload, body, headers = {}) {
  return { ok: true, status: 200, statusText: "OK", json: async () => payload, body, headers: new Headers(headers) };
}

function httpError(status, statusText = "Error") {
  return { ok: false, status, statusText, json: async () => ({}) };
}

/** Build a full SSE body that streams the given content chunks then [DONE]. */
function sseBody(contentChunks) {
  const txt =
    contentChunks
      .map(
        (c) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content: c }, finish_reason: null }] })}\n\n`
      )
      .join("") + "data: [DONE]\n\n";
  return streamFromChunks([txt]);
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hermesStream", () => {
  it("streams content chunks, calls onChunk per chunk, and returns the full text", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, sseBody(["Hello", " world"])));

    const chunks = [];
    const result = await hermesStream(
      "127.0.0.1",
      8642,
      "tok",
      [{ role: "user", content: "hi" }],
      (c) => chunks.push(c)
    );

    expect(result).toBe("Hello world");
    expect(chunks).toEqual(["Hello", " world"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("hermes-agent");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("omits the Authorization header when no token is provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, sseBody(["ok"])));

    const result = await hermesStream("localhost", 8642, "", [], vi.fn());
    expect(result).toBe("ok");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("sends X-Hermes-Session-Id header and metadata.session_id when a sessionId is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, sseBody(["ok"])));

    await hermesStream(
      "127.0.0.1",
      8642,
      "tok",
      [],
      vi.fn(),
      undefined,
      undefined,
      { sessionId: "chat-bot-42" }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Hermes-Session-Id"]).toBe("chat-bot-42");
    const body = JSON.parse(init.body);
    expect(body.metadata).toEqual({ session_id: "chat-bot-42" });
  });

  it("reports the echoed X-Hermes-Session-Id via onSessionId", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({}, sseBody(["ok"]), { "X-Hermes-Session-Id": "server-normalized" })
    );

    const seen = [];
    await hermesStream(
      "127.0.0.1",
      8642,
      "tok",
      [],
      vi.fn(),
      undefined,
      undefined,
      { onSessionId: (sid) => seen.push(sid) }
    );

    expect(seen).toEqual(["server-normalized"]);
  });

  it("forwards hermes.tool.progress SSE events via onToolCall", async () => {
    const body =
      `event: hermes.tool.progress\n` +
      `data: ${JSON.stringify({ tool: "web_search", emoji: "🔍", label: "Searching", toolCallId: "tc-1", status: "running" })}\n\n` +
      `event: hermes.tool.progress\n` +
      `data: ${JSON.stringify({ tool: "web_search", toolCallId: "tc-1", status: "completed" })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Found it" } }] })}\n\n` +
      `data: [DONE]\n\n`;
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks([body])));

    const calls = [];
    const chunks = [];
    const result = await hermesStream(
      "127.0.0.1",
      8642,
      "tok",
      [],
      (c) => chunks.push(c),
      undefined,
      undefined,
      { onToolCall: (call) => calls.push(call) }
    );

    expect(result).toBe("Found it");
    expect(chunks).toEqual(["Found it"]);
    expect(calls).toEqual([
      { tool: "web_search", emoji: "🔍", label: "Searching", toolCallId: "tc-1", status: "running" },
      { tool: "web_search", toolCallId: "tc-1", status: "completed" },
    ]);
  });

  it("reports usage from the final chunk via onUsage", async () => {
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "done" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n` +
      `data: [DONE]\n\n`;
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks([body])));

    const usages = [];
    const result = await hermesStream("127.0.0.1", 8642, "tok", [], vi.fn(), undefined, undefined, {
      onUsage: (u) => usages.push(u),
    });

    expect(result).toBe("done");
    expect(usages).toEqual([{ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }]);
  });

  it("throws on an HTTP error status", async () => {
    fetchMock.mockResolvedValueOnce(httpError(503, "Unavailable"));
    await expect(
      hermesStream("127.0.0.1", 8642, "", [], vi.fn())
    ).rejects.toThrow("HTTP 503: Unavailable");
  });

  it("merges an external abort signal via AbortSignal.any when available", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, sseBody(["ok"])));
    const controller = new AbortController();
    const result = await hermesStream(
      "127.0.0.1",
      8642,
      "",
      [],
      vi.fn(),
      controller.signal
    );
    expect(result).toBe("ok");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to a manual signal merge when AbortSignal.any is unavailable", async () => {
    const keepAny = AbortSignal.any;
    try {
      AbortSignal.any = undefined;
      fetchMock.mockResolvedValueOnce(jsonOk({}, sseBody(["ok"])));
      const controller = new AbortController();
      const chunks = [];
      const result = await hermesStream(
        "127.0.0.1",
        8642,
        "",
        [],
        (c) => chunks.push(c),
        controller.signal
      );
      expect(result).toBe("ok");
      expect(chunks).toEqual(["ok"]);
    } finally {
      AbortSignal.any = keepAny;
    }
  });

  it("warns and skips malformed SSE data lines", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk(
        {},
        streamFromChunks([
          "data: {not json}\n\n",
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("hi");
    expect(chunks).toEqual(["hi"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("handles a data event split across stream reads", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk(
        {},
        streamFromChunks([
          'data: {"choices":[{"delta":{"content":"Hel',
          'lo"}}]}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("Hello");
    expect(chunks).toEqual(["Hello"]);
  });

  it("flushes a trailing data line that has no terminating blank line", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({}, streamFromChunks(['data: {"choices":[{"delta":{"content":"tail"}}]}']))
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("tail");
    expect(chunks).toEqual(["tail"]);
  });

  it("returns early when a blank line in the trailing buffer completes a [DONE] event", async () => {
    // The final read ends with a single newline; the blank line is only
    // visible in the trailing buffer and completes the queued [DONE] event.
    fetchMock.mockResolvedValueOnce(
      jsonOk({}, streamFromChunks(["data: [DONE]\n"]))
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("");
    expect(chunks).toEqual([]);
  });

  it("returns early from the trailing buffer when a queued data event completes on a blank line", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk(
        {},
        streamFromChunks([
          'data: {"choices":[{"delta":{"content":"buffered"}}]}\n',
        ])
      )
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("buffered");
    expect(chunks).toEqual(["buffered"]);
  });

  it("completes a [DONE] event from the trailing buffer with no newline", async () => {
    // [DONE] arrives as the last bytes with no trailing newline; the final
    // processEventData() flush must observe it and return.
    fetchMock.mockResolvedValueOnce(
      jsonOk({}, streamFromChunks(["data: [DONE]"]))
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("");
    expect(chunks).toEqual([]);
  });

  it("skips an event whose data is empty after the blank line", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({}, streamFromChunks(["data:\n\n", "data: [DONE]\n\n"]))
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("");
    expect(chunks).toEqual([]);
  });

  it("ignores deltas with no content or with no choices", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk(
        {},
        streamFromChunks([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[]}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const chunks = [];
    const result = await hermesStream("127.0.0.1", 8642, "", [], (c) =>
      chunks.push(c)
    );
    expect(result).toBe("");
    expect(chunks).toEqual([]);
  });
});

describe("hermesHealthCheck", () => {
  it("returns true when the real Hermes /health endpoint is ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const ok = await hermesHealthCheck("127.0.0.1", 8642, "tok", 500);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/health");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("falls back to the legacy /v1/health endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const ok = await hermesHealthCheck("127.0.0.1", 8642, "tok", 500);
    expect(ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8642/health");
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://127.0.0.1:8642/v1/health");
  });

  it("returns false when both health endpoints fail", async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(500))
      .mockResolvedValueOnce(httpError(500));
    expect(await hermesHealthCheck("127.0.0.1", 8642, "")).toBe(false);
  });

  it("returns false when the fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await hermesHealthCheck("127.0.0.1", 8642, "")).toBe(false);
  });
});

describe("hermes agent info endpoints", () => {
  it("hermesHealth returns { status, platform, version }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ status: "ok", platform: "hermes-agent", version: "9.1.0" })
    );
    const info = await hermesHealth("127.0.0.1", 8642, "tok");
    expect(info.version).toBe("9.1.0");
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8642/health");
  });

  it("hermesHealthDetailed returns rich status", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ status: "ready", readiness: { status: "ready" }, pid: 1234 })
    );
    const info = await hermesHealthDetailed("127.0.0.1", 8642, "tok");
    expect(info.status).toBe("ready");
    expect(info.pid).toBe(1234);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8642/health/detailed");
  });

  it("hermesAgentInfo returns capabilities", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ object: "hermes.api_server.capabilities", platform: "hermes-agent", model: "deepseek-v4-flash" })
    );
    const caps = await hermesAgentInfo("127.0.0.1", 8642, "tok");
    expect(caps.platform).toBe("hermes-agent");
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8642/v1/capabilities");
  });

  it("hermesModels returns the data array", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ object: "list", data: [{ id: "hermes-agent" }] })
    );
    const models = await hermesModels("127.0.0.1", 8642, "tok");
    expect(models).toEqual([{ id: "hermes-agent" }]);
  });

  it("hermesSkills returns the skills array", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ skills: [{ name: "web" }] }));
    const skills = await hermesSkills("127.0.0.1", 8642, "tok");
    expect(skills).toEqual([{ name: "web" }]);
  });

  it("returns null / empty for non-ok responses", async () => {
    fetchMock.mockResolvedValue(httpError(401));
    expect(await hermesHealth("127.0.0.1", 8642, "bad")).toBeNull();
    expect(await hermesHealthDetailed("127.0.0.1", 8642, "bad")).toBeNull();
    expect(await hermesAgentInfo("127.0.0.1", 8642, "bad")).toBeNull();
    expect(await hermesModels("127.0.0.1", 8642, "bad")).toEqual([]);
    expect(await hermesSkills("127.0.0.1", 8642, "bad")).toEqual([]);
  });
});
