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
});