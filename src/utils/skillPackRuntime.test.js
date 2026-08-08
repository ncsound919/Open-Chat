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
    expect(typeof out.failed[0].error).toBe("string");
  });

  it("runs declared tools in order and collects output", async () => {
    const handlers = makeHandlers();
    const runtime = new SkillPackRuntime(handlers);
    const pack = { name: "social_post", tools: ["phone_control", "capture"], instructions: "post it" };
    const out = await runtime.execute(pack, { platform: "x" });
    expect(out.output.phone_control).toBeDefined();
    expect(out.output.capture).toBeDefined();
    expect(handlers.phone_control).toHaveBeenCalled();
    const pc = handlers.phone_control.mock.invocationCallOrder[0];
    const cap = handlers.capture.mock.invocationCallOrder[0];
    expect(cap).toBeGreaterThan(pc);
  });

  it("calls each handler with context spread plus pack and tool", async () => {
    const handlers = makeHandlers();
    const runtime = new SkillPackRuntime(handlers);
    const pack = { name: "social_post", version: "1.2.3", tools: ["phone_control"] };
    await runtime.execute(pack, { platform: "x" });
    expect(handlers.phone_control).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "x",
        pack,
        tool: "phone_control",
      })
    );
  });

  it("fails a step gracefully and returns partial output", async () => {
    const handlers = makeHandlers();
    handlers.capture.mockRejectedValueOnce(new Error("no cam"));
    const runtime = new SkillPackRuntime(handlers);
    const pack = { name: "capture_only", version: "1.0.0", tools: ["capture"] };
    const out = await runtime.execute(pack, {});
    expect(out.failed.length).toBe(1);
    expect(out.failed[0].tool).toBe("capture");
    expect(typeof out.failed[0].error).toBe("string");
    expect(out.failed[0].error).toContain("no cam");
    expect(out.output.capture.ok).toBe(false);
    expect(out.output.capture.error).toBe("no cam");
  });

  it("records non-Error rejections as strings", async () => {
    const handlers = makeHandlers();
    handlers.capture.mockRejectedValueOnce("boom");
    const runtime = new SkillPackRuntime(handlers);
    const out = await runtime.execute({ name: "capture_only", tools: ["capture"] }, {});
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].error).toBe("boom");
    expect(out.output.capture.error).toBe("boom");
  });

  it("times out a handler that never resolves and records it as a failure", async () => {
    const handlers = makeHandlers();
    handlers.capture.mockReturnValue(new Promise(() => {}));
    const runtime = new SkillPackRuntime(handlers, { timeoutMs: 20 });
    const out = await runtime.execute({ name: "hang", tools: ["capture"] }, {});
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].tool).toBe("capture");
    expect(out.failed[0].error).toContain("tool timeout");
    expect(out.output.capture.ok).toBe(false);
  });

  it("returns the pack name and version", async () => {
    const runtime = new SkillPackRuntime(makeHandlers());
    const out = await runtime.execute({ name: "social_post", version: "2.0.0", tools: [] }, {});
    expect(out.pack).toBe("social_post");
    expect(out.version).toBe("2.0.0");
  });

  it("defaults missing version to unknown", async () => {
    const runtime = new SkillPackRuntime(makeHandlers());
    const out = await runtime.execute({ name: "no_version", tools: [] }, {});
    expect(out.version).toBe("unknown");
  });

  it("handles an empty tools array", async () => {
    const runtime = new SkillPackRuntime(makeHandlers());
    const out = await runtime.execute({ name: "empty", tools: [] }, {});
    expect(out.output).toEqual({});
    expect(out.failed).toEqual([]);
  });

  it("handles a pack with no tools field", async () => {
    const runtime = new SkillPackRuntime(makeHandlers());
    const out = await runtime.execute({ name: "no_tools" }, {});
    expect(out.output).toEqual({});
    expect(out.failed).toEqual([]);
  });
});
