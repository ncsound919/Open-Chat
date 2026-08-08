import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerClient } from "./workerClient.js";
import { LocalSkillLibrary } from "./localSkillLibrary.js";
import { SkillPackRuntime } from "./skillPackRuntime.js";

describe("worker simulation (Open Chat)", () => {
  let client, lib, runtime, store, m;
  const fetchCalls = [];

  function mockServer() {
    return vi.fn(async (url, init = {}) => {
      const path = String(url);
      const method = String(init.method || "GET").toUpperCase();
      const auth = init.headers?.Authorization ?? null;
      fetchCalls.push({ path, method, auth, body: init.body ? JSON.parse(init.body) : undefined });

      // Every worker request must be a Bearer-authed call to the Draymond API.
      expect(path).toMatch(/^http:\/\/127\.0\.0\.1:8644\/api\/v1\/worker\//);
      expect(auth).toBe("Bearer tok");

      if (path.includes("/worker/tasks?worker_id=")) {
        expect(method).toBe("GET");
        return { ok: true, json: async () => ({ ok: true, tasks: [{ id: "t1", skill_pack_id: "social_post:1.0.0", status: "queued" }] }) };
      }
      if (path.endsWith("/claim")) {
        expect(method).toBe("POST");
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (path.endsWith("/report")) {
        expect(method).toBe("POST");
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error(`unexpected request: ${method} ${path}`);
    });
  }

  beforeEach(() => {
    fetchCalls.length = 0;
    m = new Map();
    store = {
      get: vi.fn(async (k) => m.get(k) ?? null),
      set: vi.fn(async (k, v) => { m.set(k, v); }),
    };
    lib = new LocalSkillLibrary(store);
    runtime = new SkillPackRuntime({
      phone_control: async (args) => ({ ok: true, action: `tapped ${args.platform}` }),
      email: async () => ({ ok: true, sent: true }),
    });
    client = new WorkerClient("http://127.0.0.1:8644", "tok");
    vi.stubGlobal("fetch", mockServer());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pulls a task, executes its pack, caches it, claims, and reports", async () => {
    const tasks = await client.pullTasks("worker-1");
    expect(tasks.length).toBe(1);
    expect(tasks[0].skill_pack_id).toBe("social_post:1.0.0");

    // The worker resolves the pack (from cache or fetch) and runs it.
    const [name, version] = tasks[0].skill_pack_id.split(":");
    const pack = { name, version, tools: ["phone_control", "email"] };
    await lib.cache(name, version, pack);

    // Cache write actually landed.
    const cached = await lib.get(name, version);
    expect(cached).not.toBeNull();
    expect(cached.name).toBe("social_post");
    expect(cached.version).toBe("1.0.0");
    expect(store.set).toHaveBeenCalledWith(expect.stringContaining("social_post:1.0.0"), expect.any(Object));

    const out = await runtime.execute(pack, { platform: "x" });
    expect(out.output.phone_control.ok).toBe(true);
    expect(out.output.email.sent).toBe(true);
    expect(out.failed).toHaveLength(0);

    const claimed = await client.claimTask("t1", "worker-1");
    expect(claimed).toBe(true);

    const ok = await client.reportTask("t1", { ok: true, output: out.output }, ["uri://shot.png"]);
    expect(ok).toBe(true);

    // Assert the report body carried the output + artifact refs.
    const report = fetchCalls.find((c) => c.path.endsWith("/report"));
    expect(report).toBeDefined();
    expect(report.body.artifact_refs).toEqual(["uri://shot.png"]);
    expect(report.body.result.output.phone_control.ok).toBe(true);

    // Full wire sequence: pull → claim → report.
    expect(fetchCalls.map((c) => (c.path.includes("tasks?") ? "pull" : c.path.includes("claim") ? "claim" : "report"))).toEqual(["pull", "claim", "report"]);
  });
});
