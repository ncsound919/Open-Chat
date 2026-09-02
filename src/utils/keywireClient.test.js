import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KeywireClient, normalizeBaseUrl, KEYWIRE_DEFAULT_BASE } from "./keywireClient.js";

const json = (payload, { ok = true, status = 200 } = {}) =>
  ({ ok, status, json: async () => payload });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeBaseUrl", () => {
  it("defaults to KEYWIRE_DEFAULT_BASE", () => {
    expect(normalizeBaseUrl("")).toBe(KEYWIRE_DEFAULT_BASE);
    expect(normalizeBaseUrl(null)).toBe(KEYWIRE_DEFAULT_BASE);
  });
  it("adds http:// when no scheme and strips trailing slash", () => {
    expect(normalizeBaseUrl("keywire.local:8080/")).toBe("http://keywire.local:8080");
  });
  it("rejects non-http(s) schemes", () => {
    expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow();
  });
});

describe("KeywireClient", () => {
  it("sends the bearer token on authenticated requests", async () => {
    fetchMock.mockResolvedValue(json([{ id: "p1", slug: "prod" }]));
    const c = new KeywireClient("http://127.0.0.1:3000", "tok123");
    await c.listProjects();
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer tok123");
  });

  it("listProjects accepts a bare array and a wrapper object", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "p1" }]));
    const c = new KeywireClient("http://127.0.0.1:3000", "");
    expect((await c.listProjects()).projects).toEqual([{ id: "p1" }]);

    fetchMock.mockResolvedValueOnce(json({ projects: [{ id: "p2" }] }));
    expect((await c.listProjects()).projects).toEqual([{ id: "p2" }]);
  });

  it("listSecrets stays masked by default and passes ?unmask=true only on request", async () => {
    fetchMock.mockResolvedValueOnce(json([{ key: "A", value: "••••••" }]));
    const c = new KeywireClient("http://127.0.0.1:3000", "");
    await c.listSecrets("p1", "production");
    expect(fetchMock.mock.calls[0][0]).not.toContain("unmask=true");

    await c.listSecrets("p1", "production", { unmask: true });
    expect(fetchMock.mock.calls[1][0]).toContain("unmask=true");
  });

  it("getSecretValue filters the unmasked list for the exact key", async () => {
    fetchMock.mockResolvedValue(
      json([
        { key: "DRAYMOND_TOKEN", value: "real-secret", currentVersion: 3 },
        { key: "OTHER", value: "masked" },
      ])
    );
    const c = new KeywireClient("http://127.0.0.1:3000", "tok");
    const res = await c.getSecretValue("p1", "production", "DRAYMOND_TOKEN");
    expect(res).toMatchObject({ ok: true, value: "real-secret", currentVersion: 3 });
    expect(res.masked).toBe(false);
  });

  it("getSecretValue reports not-found gracefully", async () => {
    fetchMock.mockResolvedValue(json([{ key: "A", value: "x" }]));
    const c = new KeywireClient("http://127.0.0.1:3000", "tok");
    const res = await c.getSecretValue("p1", "production", "MISSING");
    expect(res.ok).toBe(false);
  });

  it("returns ok:false on HTTP errors and network failures without throwing", async () => {
    fetchMock.mockResolvedValueOnce(json({}, { ok: false, status: 500 }));
    const c = new KeywireClient("http://127.0.0.1:3000", "");
    expect((await c.listProjects()).ok).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect((await c.listProjects()).ok).toBe(false);
  });

  it("healthCheck reports 401 as auth-needed", async () => {
    fetchMock.mockResolvedValue(json({}, { ok: false, status: 401 }));
    const c = new KeywireClient("http://127.0.0.1:3000", "bad");
    const res = await c.healthCheck();
    expect(res.ok).toBe(false);
    expect(res.auth).toBe(true);
  });
});
