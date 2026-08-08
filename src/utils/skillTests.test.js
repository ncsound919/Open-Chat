import { describe, it, expect, vi } from "vitest";
import { runSkillTests, SKILL_TEST_CASES } from "./skillTests.js";

/** Build a phone-control mock whose behavior follows an `enabled` flag. */
function mockPhone(enabled = true) {
  return {
    getStatus: vi.fn(async () => ({ enabled, available: true })),
    getForegroundApp: vi.fn(async () => ({ packageName: "com.samsung.android.app.notes", className: "X" })),
    readScreen: vi.fn(async () => ({
      foregroundPackage: "com.samsung.android.app.notes",
      nodes: [
        { text: "Note body", desc: "", clickable: false, x: 50, y: 200, w: 300, h: 30 },
        { text: "", desc: "AI assist", clickable: true, x: 300, y: 500, w: 60, h: 60 },
      ],
    })),
    performTap: vi.fn(async () => ({ ok: true })),
    inputText: vi.fn(async () => ({ ok: true })),
    performGlobalAction: vi.fn(async () => ({ ok: true })),
    openApp: vi.fn(async ({ packageName }) => ({ ok: !!packageName })),
    swipe: vi.fn(async () => ({ ok: true })),
    screenshot: vi.fn(async () => ({ ok: true, data: ".." })),
  };
}

describe("SKILL_TEST_CASES", () => {
  it("covers phone + galaxy skills", () => {
    expect(SKILL_TEST_CASES.length).toBeGreaterThan(0);
    expect(SKILL_TEST_CASES.some((t) => t.kind === "phone")).toBe(true);
    expect(SKILL_TEST_CASES.some((t) => t.kind === "galaxy")).toBe(true);
  });
});

describe("runSkillTests", () => {
  it("reports pass/fail per case with accessibility enabled", async () => {
    const results = await runSkillTests({ phoneControl: mockPhone(true) });
    expect(results.length).toBe(SKILL_TEST_CASES.length);
    const openNotes = results.find((r) => r.name === "open_notes");
    expect(openNotes.ok).toBe(true);
    const readScreen = results.find((r) => r.name === "read_screen");
    expect(readScreen.ok).toBe(true);
    expect(readScreen.ms).toBeGreaterThanOrEqual(0);
  });

  it("marks all as failed without a bridge", async () => {
    const results = await runSkillTests({ phoneControl: null });
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].detail).toMatch(/no phone-control bridge/);
  });

  it("reports accessibility gating when disabled", async () => {
    const results = await runSkillTests({ phoneControl: mockPhone(false) });
    const openNotes = results.find((r) => r.name === "open_notes");
    expect(openNotes.ok).toBe(false);
  });
});
