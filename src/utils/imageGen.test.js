import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImage, IMAGE_GEN_TOOL } from "./imageGen.js";

describe("IMAGE_GEN_TOOL", () => {
  it("has the expected schema", () => {
    expect(IMAGE_GEN_TOOL.name).toBe("image_gen");
    expect(IMAGE_GEN_TOOL.parameters.prompt).toBeDefined();
  });
});

describe("generateImage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("requires a prompt", async () => {
    const res = await generateImage({});
    expect(res.ok).toBe(false);
  });

  it("reports when phone control is unavailable", async () => {
    const { generateImage: g } = await import("./imageGen.js");
    const res = await g({ prompt: "a cat" });
    expect(res.ok).toBe(false);
  });

  it("opens Off Grid when phone control is enabled", async () => {
    const phone = {
      getStatus: vi.fn(async () => ({ enabled: true })),
      openApp: vi.fn(async () => ({ ok: true })),
    };
    const res = await generateImage({ prompt: "a cute robot", phoneControl: phone });
    expect(res.ok).toBe(true);
    expect(res.opened).toBe(true);
    expect(phone.openApp).toHaveBeenCalledWith({ packageName: "ai.offgridmobile" });
  });

  it("reports when the accessibility service is disabled", async () => {
    const phone = { getStatus: vi.fn(async () => ({ enabled: false })), openApp: vi.fn() };
    const res = await generateImage({ prompt: "a cat", phoneControl: phone });
    expect(res.ok).toBe(false);
    expect(res.needs_enablement).toBe(true);
  });
});
