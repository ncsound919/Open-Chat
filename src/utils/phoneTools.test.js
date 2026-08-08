import { describe, it, expect, vi } from "vitest";
import {
  PHONE_TOOLS,
  isPhoneTool,
  execPhoneTool,
} from "./phoneTools.js";

vi.mock("@open-chat/mediapipe-gemma", () => ({
  default: {
    getStatus: vi.fn(async () => ({ available: true, modelLoaded: false })),
    listModels: vi.fn(async () => ({ models: [] })),
  },
}));

vi.mock("@open-chat/phone-control", () => ({
  default: {
    getStatus: vi.fn(async () => ({ enabled: false, available: true })),
    readScreen: vi.fn(async () => ({ nodes: [] })),
    performTap: vi.fn(),
    inputText: vi.fn(),
    performGlobalAction: vi.fn(),
    openApp: vi.fn(),
    swipe: vi.fn(),
    screenshot: vi.fn(),
  },
}));

function mockPlugin(overrides = {}) {
  return {
    getStatus: vi.fn(async () => ({ enabled: true, available: true })),
    getForegroundApp: vi.fn(async () => ({ packageName: "com.whatsapp", className: "X" })),
    readScreen: vi.fn(async () => ({
      foregroundPackage: "com.whatsapp",
      nodes: [
        { text: "Send", desc: "", clickable: true, x: 100, y: 200, w: 80, h: 40 },
        { text: "", desc: "Back", clickable: true, x: 20, y: 60, w: 50, h: 50 },
      ],
    })),
    performTap: vi.fn(async () => ({ ok: true })),
    inputText: vi.fn(async () => ({ ok: true })),
    performGlobalAction: vi.fn(async () => ({ ok: true })),
    openApp: vi.fn(async () => ({ ok: true })),
    swipe: vi.fn(async () => ({ ok: true })),
    screenshot: vi.fn(async () => ({ ok: true, data: "..." })),
    ...overrides,
  };
}

describe("isPhoneTool", () => {
  it("recognizes known tools", () => {
    expect(isPhoneTool("tap")).toBe(true);
    expect(isPhoneTool("read_screen")).toBe(true);
    expect(isPhoneTool("nope")).toBe(false);
  });
});

describe("PHONE_TOOLS", () => {
  it("exposes the expected tool set", () => {
    const names = PHONE_TOOLS.map((t) => t.name);
    for (const n of ["get_foreground", "read_screen", "open_app", "tap", "type", "press", "swipe"]) {
      expect(names).toContain(n);
    }
  });
});

describe("execPhoneTool", () => {
  it("returns an enablement hint when accessibility is off", async () => {
    const plugin = mockPlugin({ getStatus: vi.fn(async () => ({ enabled: false })) });
    const res = await execPhoneTool("read_screen", {}, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.needs_enablement).toBe(true);
  });

  it("reads the screen and returns elements", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("read_screen", {}, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(res.foreground_package).toBe("com.whatsapp");
    expect(res.elements.length).toBe(2);
  });

  it("opens an app by package", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("open_app", { package_name: "com.whatsapp" }, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(plugin.openApp).toHaveBeenCalledWith({ packageName: "com.whatsapp" });
  });

  it("taps by text lookup using element center", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("tap", { text: "Send" }, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(plugin.performTap).toHaveBeenCalledWith({ x: 140, y: 220 });
  });

  it("taps by exact coordinates", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("tap", { x: 50, y: 60 }, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(plugin.performTap).toHaveBeenCalledWith({ x: 50, y: 60 });
  });

  it("reports a missing element", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("tap", { text: "Nope" }, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Could not find/);
  });

  it("types text into the focused field", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("type", { text: "hello" }, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(plugin.inputText).toHaveBeenCalledWith({ text: "hello" });
  });

  it("presses a system key", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("press", { key: "back" }, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(plugin.performGlobalAction).toHaveBeenCalledWith({ action: "back" });
  });

  it("swipes", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool(
      "swipe",
      { from_x: 100, from_y: 2000, to_x: 100, to_y: 300 },
      { phoneControl: plugin }
    );
    expect(res.ok).toBe(true);
  });

  it("returns an error for unknown tools", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("teleport", {}, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown phone tool/);
  });
});

describe("phoneTools capture", () => {
  it("registers capture_screenshot as a phone tool", () => {
    expect(isPhoneTool("capture_screenshot")).toBe(true);
  });

  it("exposes capture_screenshot in PHONE_TOOLS", () => {
    const names = PHONE_TOOLS.map((t) => t.name);
    expect(names).toContain("capture_screenshot");
  });

  it("captures a screenshot and surfaces the returned data", async () => {
    const plugin = mockPlugin();
    const res = await execPhoneTool("capture_screenshot", {}, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(res.screenshot).toBe("...");
    expect(res.mime).toBe("image/png");
    expect(plugin.screenshot).toHaveBeenCalled();
  });

  it("surfaces a file uri when the plugin returns one", async () => {
    const plugin = mockPlugin({
      screenshot: vi.fn(async () => ({ ok: true, uri: "file:///tmp/shot.png" })),
    });
    const res = await execPhoneTool("capture_screenshot", {}, { phoneControl: plugin });
    expect(res.ok).toBe(true);
    expect(res.screenshot).toBe("file:///tmp/shot.png");
    expect(res.source).toBe("uri");
  });

  it("fails when native screenshot support is missing", async () => {
    const plugin = mockPlugin({ screenshot: undefined });
    const res = await execPhoneTool("capture_screenshot", {}, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/native screenshot support/);
  });

  it("propagates a plugin ok:false failure", async () => {
    const plugin = mockPlugin({
      screenshot: vi.fn(async () => ({ ok: false, error: "screenshot unavailable on this device" })),
    });
    const res = await execPhoneTool("capture_screenshot", {}, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unavailable/);
  });

  it("reports a rejected screenshot call", async () => {
    const plugin = mockPlugin({
      screenshot: vi.fn(async () => {
        throw new Error("screenshot failed");
      }),
    });
    const res = await execPhoneTool("capture_screenshot", {}, { phoneControl: plugin });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/screenshot failed/);
  });
});
