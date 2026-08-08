import { describe, it, expect, vi, beforeEach } from "vitest";
import { heuristicCheck, verifyOutput } from "./verification.js";

vi.mock("./OnDeviceAI.js", () => ({
  isAvailable: vi.fn(async () => false),
  generate: vi.fn(async () => ""),
}));

describe("heuristicCheck", () => {
  it("passes a plausible output", () => {
    const r = heuristicCheck("summarize", "The phone is on. The model works.");
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.provider).toBe("heuristic");
  });

  it("flags error markers and empties", () => {
    expect(heuristicCheck("x", "").ok).toBe(false);
    expect(heuristicCheck("x", "Task failed because of an error").ok).toBe(false);
    expect(heuristicCheck("x", "hi").ok).toBe(false);
    expect(heuristicCheck("x", "hi").score).toBeLessThan(100);
  });
});

describe("verifyOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns off when disabled", async () => {
    const r = await verifyOutput({ task: "t", output: "o", enabled: false });
    expect(r.provider).toBe("off");
    expect(r.ok).toBe(true);
  });

  it("falls back to heuristic when Nano is unavailable", async () => {
    const r = await verifyOutput({ task: "t", output: "A reasonable answer." });
    expect(r.provider).toBe("heuristic");
    expect(typeof r.score).toBe("number");
  });

  it("flags missing inputs", async () => {
    const r = await verifyOutput({ task: "", output: "" });
    expect(r.ok).toBe(false);
  });
});
