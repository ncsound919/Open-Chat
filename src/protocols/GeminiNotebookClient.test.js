import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENDPOINT = "http://127.0.0.1:3700/api/notebook";

describe("GeminiNotebookClient", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("posts an action to the bridge with X-Agent-Auth and returns JSON", async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { accounts: ["tap4500"] } }), { status: 200 }));
    global.fetch = fake;
    const { notebookRequest } = await import("./GeminiNotebookClient.js");
    const res = await notebookRequest({ host: "127.0.0.1", port: 3700, token: "secret", action: "notebook.account" });
    expect(fake).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "X-Agent-Auth": "secret" }) })
    );
    expect(res.ok).toBe(true);
  });

  it("wraps non-ok HTTP responses as { ok:false, error }", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 }));
    const { notebookRequest } = await import("./GeminiNotebookClient.js");
    const res = await notebookRequest({ host: "127.0.0.1", port: 3700, token: "x", action: "notebook.list" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/401/);
  });

  it("returns ok:false on a network error", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const { notebookRequest } = await import("./GeminiNotebookClient.js");
    const res = await notebookRequest({ host: "127.0.0.1", port: 3700, token: "x", action: "notebook.list" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/network down/);
  });

  it("returns ok:false for a non-JSON 200 body instead of fabricating success", async () => {
    global.fetch = vi.fn(async () => new Response("not json", { status: 200 }));
    const { notebookRequest } = await import("./GeminiNotebookClient.js");
    const res = await notebookRequest({ host: "127.0.0.1", port: 3700, token: "x", action: "notebook.list" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/non-JSON/);
  });

  it("returns ok:false when the host is not configured", async () => {
    global.fetch = vi.fn();
    const { notebookRequest } = await import("./GeminiNotebookClient.js");
    const res = await notebookRequest({ host: "  ", port: 3700, token: "x", action: "notebook.list" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/host not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("aborts the request when an external signal fires", async () => {
    global.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    const { notebookRequest } = await import("./GeminiNotebookClient.js");
    const controller = new AbortController();
    const promise = notebookRequest({
      host: "127.0.0.1",
      port: 3700,
      token: "x",
      action: "notebook.list",
      signal: controller.signal,
    });
    controller.abort();
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/aborted/);
  });
});