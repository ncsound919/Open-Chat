import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  estimateTokens,
  tokensPerSec,
  timeAsync,
  makeRunId,
  toBenchmarkRow,
  buildBenchmarkRows,
  syncBenchmarksViaDraymond,
} from "./benchmarks.js";

describe("estimateTokens / tokensPerSec", () => {
  it("approximates tokens and rate", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(tokensPerSec("a".repeat(400), 1000)).toBe(100);
    expect(tokensPerSec("x", 0)).toBe(0);
  });
});

describe("timeAsync", () => {
  it("returns elapsed ms and value", async () => {
    const r = await timeAsync(async () => {
      await new Promise((res) => setTimeout(res, 10));
      return 42;
    });
    expect(r.value).toBe(42);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("captures errors", async () => {
    const r = await timeAsync(async () => {
      throw new Error("boom");
    });
    expect(r.error).toBe("boom");
  });
});

describe("makeRunId / toBenchmarkRow", () => {
  it("makes a unique run id", () => {
    expect(makeRunId()).toMatch(/^oc-bench-/);
    expect(makeRunId()).not.toBe(makeRunId());
  });

  it("normalizes a row", () => {
    const row = toBenchmarkRow({
      runId: "r1",
      slug: "local.model.generate",
      name: "Generation",
      metrics: { ms: 5 },
      weakness_score: 3,
    });
    expect(row.run_id).toBe("r1");
    expect(row.component_class).toBe("entity");
    expect(row.component_slug).toBe("local.model.generate");
    expect(row.weakness_score).toBe(3);
    expect(row.metrics.ms).toBe(5);
  });

  it("builds a row list", () => {
    const rows = buildBenchmarkRows("r1", [
      { slug: "a", name: "A", metrics: {} },
      { slug: "b", name: "B", metrics: {}, weakness_score: 10 },
    ]);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.run_id === "r1")).toBe(true);
  });
});

describe("syncBenchmarksViaDraymond", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it("posts rows to the Draymond benchmarks route", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, count: 2 }),
    }));
    const res = await syncBenchmarksViaDraymond({
      baseUrl: "http://127.0.0.1:3444/api",
      token: "secret",
      rows: [{ run_id: "r", component_class: "entity", component_slug: "s", component_name: "n" }],
    });
    expect(res.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3444/api/v1/benchmarks");
    expect(init.headers.Authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body);
    expect(body.rows.length).toBe(1);
  });

  it("returns an error on non-ok", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const res = await syncBenchmarksViaDraymond({ baseUrl: "http://x", rows: [{ a: 1 }] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 500/);
  });

  it("requires baseUrl and rows", async () => {
    expect((await syncBenchmarksViaDraymond({ rows: [] })).ok).toBe(false);
    expect((await syncBenchmarksViaDraymond({ baseUrl: "x" })).ok).toBe(false);
  });
});
