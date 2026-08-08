import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncMessagesToDraymond, lastLocalExchange } from "./draymondSync.js";

describe("syncMessagesToDraymond", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it("posts messages with the bearer token and resolves ok", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    const res = await syncMessagesToDraymond({
      baseUrl: "http://127.0.0.1:3444/api",
      token: "secret",
      sessionId: "local-1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3444/api/v1/messages");
    expect(init.headers.Authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body);
    expect(body.session_id).toBe("local-1");
    expect(body.messages[0].metadata.source).toBe("open-chat-local");
  });

  it("returns an error on non-ok response", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const res = await syncMessagesToDraymond({
      baseUrl: "http://x/api",
      sessionId: "s",
      messages: [{ role: "user", content: "x" }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 500/);
  });

  it("requires messages", async () => {
    const res = await syncMessagesToDraymond({ baseUrl: "http://x/api", sessionId: "s" });
    expect(res.ok).toBe(false);
  });
});

describe("lastLocalExchange", () => {
  it("extracts the trailing user + assistant pair", () => {
    const messages = [
      { role: "user", text: "earlier" },
      { role: "assistant", text: "old reply" },
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello!" },
    ];
    expect(lastLocalExchange(messages)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello!" },
    ]);
  });

  it("handles empty history", () => {
    expect(lastLocalExchange([])).toEqual([]);
  });
});
