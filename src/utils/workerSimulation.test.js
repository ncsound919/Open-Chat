import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerClient } from "./workerClient.js";
import { LocalSkillLibrary } from "./localSkillLibrary.js";
import { SkillPackRuntime } from "./skillPackRuntime.js";

describe("worker simulation (Open Chat)", () => {
  let client, lib, runtime;
  beforeEach(() => {
    const m = new Map();
    const store = {
      get: vi.fn(async (k) => m.get(k) ?? null),
      set: vi.fn(async (k, v) => { m.set(k, v); }),
    };
    lib = new LocalSkillLibrary(store);
    runtime = new SkillPackRuntime({
      phone_control: async (args) => ({ ok: true, action: `tapped ${args.platform}` }),
      email: async () => ({ ok: true, sent: true }),
    });
    client = new WorkerClient("http://127.0.0.1:8644", "tok");
    global.fetch = vi.fn(async (url) => {
      const path = String(url);
      if (path.includes("/worker/tasks?worker_id=")) return { ok: true, json: async () => ({ ok: true, tasks: [{ id: "t1", skill_pack_id: "social_post:1.0.0", status: "queued" }] }) };
      if (path.includes("/claim")) return { ok: true, json: async () => ({ ok: true }) };
      if (path.includes("/report")) return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => ({ ok: true }) };
    });
  });

  it("pulls a task, executes its pack, reports, and caches the pack", async () => {
    const tasks = await client.pullTasks("worker-1");
    expect(tasks.length).toBe(1);
    const pack = { name: "social_post", version: "1.0.0", tools: ["phone_control", "email"] };
    await lib.cache("social_post", "1.0.0", pack);
    const out = await runtime.execute(pack, { platform: "x" });
    expect(out.output.phone_control.ok).toBe(true);
    await client.claimTask("t1", "worker-1");
    const ok = await client.reportTask("t1", { ok: true, output: out.output }, ["uri://shot.png"]);
    expect(ok).toBe(true);
  });
});
