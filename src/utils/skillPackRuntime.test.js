import { describe, it, expect, vi } from "vitest";
import { SkillPackRuntime } from "./skillPackRuntime.js";

function makeHandlers() {
  return {
    phone_control: vi.fn(async ({ pack }) => ({ ok: true, pack: pack.name })),
    ai_apps: vi.fn(async () => ({ ok: true })),
    capture: vi.fn(async () => ({ ok: true, media: "clip" })),
    email: vi.fn(async () => ({ ok: true })),
    web: vi.fn(async () => ({ ok: true })),
  };
}

describe("SkillPackRuntime", () => {
  it("reports packs declaring unknown tools without throwing", async () => {
    const handlers = makeHandlers();
    const runtime = new SkillPackRuntime(handlers);
    const out = await runtime.execute({ name: "mystery_pack", tools: ["mystery"] }, {});
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].tool).toBe("mystery");
    expect(out.failed[0].error).toMatch(/unknown tool/i);
  });

  it("runs declared tools in order and collects output", async () => {
    const handlers = makeHandlers();
    const runtime = new SkillPackRuntime(handlers);
    const pack = { name: "social_post", tools: ["phone_control", "capture"], instructions: "post it" };
    const out = await runtime.execute(pack, { platform: "x" });
    expect(out.output.phone_control).toBeDefined();
    expect(out.output.capture).toBeDefined();
    expect(handlers.phone_control).toHaveBeenCalled();
  });

  it("fails a step gracefully and returns partial output", async () => {
    const handlers = makeHandlers();
    handlers.capture.mockRejectedValueOnce(new Error("no cam"));
    const runtime = new SkillPackRuntime(handlers);
    const pack = { name: "capture_only", tools: ["capture"] };
    const out = await runtime.execute(pack, {});
    expect(out.failed.length).toBe(1);
    expect(out.failed[0].tool).toBe("capture");
    expect(out.failed[0].error.message).toBe("no cam");
    expect(out.output.capture.ok).toBe(false);
  });
});
