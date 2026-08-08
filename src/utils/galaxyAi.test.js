import { describe, it, expect, vi } from "vitest";
import {
  GALAXY_AI_SKILLS,
  SAMSUNG_APPS,
  isGalaxySkill,
  execGalaxySkill,
} from "./galaxyAi.js";

function mockPlugin(overrides = {}) {
  return {
    getStatus: vi.fn(async () => ({ enabled: true, available: true })),
    openApp: vi.fn(async ({ packageName }) => ({ ok: !!packageName })),
    readScreen: vi.fn(async () => ({
      foregroundPackage: "com.samsung.android.app.notes",
      nodes: [
        { text: "", desc: "AI assist", clickable: true, x: 300, y: 500, w: 60, h: 60 },
        { text: "Note title", desc: "", clickable: false, x: 50, y: 200, w: 300, h: 30 },
      ],
    })),
    performTap: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("isGalaxySkill", () => {
  it("recognizes Galaxy skills", () => {
    expect(isGalaxySkill("galaxy_open")).toBe(true);
    expect(isGalaxySkill("galaxy_ai_action")).toBe(true);
    expect(isGalaxySkill("galaxy_read_screen")).toBe(true);
    expect(isGalaxySkill("nope")).toBe(false);
    expect(isGalaxySkill("tap")).toBe(false);
  });
});

describe("GALAXY_AI_SKILLS", () => {
  it("exposes the three skills", () => {
    const names = GALAXY_AI_SKILLS.map((s) => s.name);
    expect(names).toContain("galaxy_open");
    expect(names).toContain("galaxy_ai_action");
    expect(names).toContain("galaxy_read_screen");
  });

  it("maps Samsung apps to packages", () => {
    expect(SAMSUNG_APPS.notes).toBe("com.samsung.android.app.notes");
    expect(SAMSUNG_APPS.messages).toBe("com.samsung.android.messaging");
  });
});

describe("execGalaxySkill", () => {
  it("requires accessibility to be enabled", async () => {
    const plugin = mockPlugin({ getStatus: vi.fn(async () => ({ enabled: false })) });
    const res = await execGalaxySkill("galaxy_open", { app: "notes" }, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.needs_enablement).toBe(true);
  });

  it("opens a Samsung app", async () => {
    const plugin = mockPlugin();
    const res = await execGalaxySkill("galaxy_open", { app: "notes" }, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(plugin.openApp).toHaveBeenCalledWith({ packageName: "com.samsung.android.app.notes" });
  });

  it("rejects unknown Samsung apps", async () => {
    const plugin = mockPlugin();
    const res = await execGalaxySkill("galaxy_open", { app: "camera" }, { phoneControl: plugin });
    expect(res.ok).toBe(false);
  });

  it("taps the AI trigger and returns visible text", async () => {
    const plugin = mockPlugin();
    const res = await execGalaxySkill(
      "galaxy_ai_action",
      { app: "notes", action: "summarize" },
      { phoneControl: plugin }
    );
    expect(res.ok).toBe(true);
    expect(res.action).toBe("summarize");
    expect(plugin.performTap).toHaveBeenCalled();
    expect(res.result).toContain("Note title");
  });

  it("reports when no AI trigger is found", async () => {
    const plugin = mockPlugin({
      readScreen: vi.fn(async () => ({
        nodes: [{ text: "Hello", desc: "", clickable: false, x: 0, y: 0, w: 10, h: 10 }],
      })),
    });
    const res = await execGalaxySkill(
      "galaxy_ai_action",
      { app: "notes", action: "summarize" },
      { phoneControl: plugin }
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No Galaxy AI button/);
  });

  it("reads the screen for galaxy_read_screen", async () => {
    const plugin = mockPlugin();
    const res = await execGalaxySkill("galaxy_read_screen", {}, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(res.text).toContain("Note title");
  });

  it("returns an error for unknown skills", async () => {
    const plugin = mockPlugin();
    const res = await execGalaxySkill("galaxy_fly", {}, { phoneControl: plugin });
    expect(res.ok).toBe(false);
  });
});
