import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  pullTasks: vi.fn(),
  claimTask: vi.fn(),
  reportTask: vi.fn(),
  listSkills: vi.fn(),
  fetchSkill: vi.fn(),
  proposeSkill: vi.fn(),
  heartbeat: vi.fn(),
  enqueueTask: vi.fn(),
}));

vi.mock("./workerClient.js", () => ({
  WorkerClient: class {
    constructor(baseUrl, token, workerId) {
      this.baseUrl = baseUrl;
      this.token = token;
      this.workerId = workerId;
    }
    pullTasks = mocks.pullTasks;
    claimTask = mocks.claimTask;
    reportTask = mocks.reportTask;
    listSkills = mocks.listSkills;
    fetchSkill = mocks.fetchSkill;
    proposeSkill = mocks.proposeSkill;
    heartbeat = mocks.heartbeat;
    enqueueTask = mocks.enqueueTask;
  },
}));

import { createWorkerEngine, resolveWorkerBaseUrl } from "./workerEngine.js";

function fakeStore() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
  };
}

function queuedTask(overrides = {}) {
  return {
    id: "task-1",
    worker_id: null,
    skill_pack_id: "test_pack:1.0.0",
    payload: { platform: "x" },
    status: "queued",
    due_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const TEST_PACK = {
  name: "test_pack",
  version: "1.0.0",
  purpose: "test",
  tools: ["outputs"],
  outputs: ["done"],
  instructions: "run it",
  platforms: ["android"],
  review_status: "approved",
  source: "draymond",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSkills.mockResolvedValue([{ name: "test_pack", version: "1.0.0", tools: ["outputs"] }]);
  mocks.claimTask.mockResolvedValue(true);
  mocks.reportTask.mockResolvedValue(true);
  mocks.heartbeat.mockResolvedValue(true);
  mocks.fetchSkill.mockResolvedValue(TEST_PACK);
  mocks.proposeSkill.mockResolvedValue(true);
});

describe("resolveWorkerBaseUrl", () => {
  it("normalizes local host, remote hostname and full URLs", () => {
    expect(resolveWorkerBaseUrl({ host: "127.0.0.1", port: 8644 })).toBe("http://127.0.0.1:8644");
    expect(resolveWorkerBaseUrl({ host: "localhost", port: 8644 })).toBe("http://localhost:8644");
    expect(resolveWorkerBaseUrl({ host: "mytunnel.trycloudflare.com" })).toBe("https://mytunnel.trycloudflare.com");
    expect(resolveWorkerBaseUrl({ host: "https://x.trycloudflare.com/api" })).toBe("https://x.trycloudflare.com");
    expect(resolveWorkerBaseUrl({ host: "" })).toBe("");
  });
});

describe("createWorkerEngine", () => {
  it("pulls tasks and auto-executes a queued one end-to-end", async () => {
    const task = queuedTask();
    mocks.pullTasks.mockResolvedValue([task]);

    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      workerId: "test-worker",
      store: fakeStore(),
      deps: { chat: vi.fn(), onSend: vi.fn(), onNotify: vi.fn() },
    });
    const states = [];
    engine.subscribe((s) => states.push(s));

    await engine.pull();

    expect(mocks.claimTask).toHaveBeenCalledWith("task-1");
    expect(mocks.fetchSkill).toHaveBeenCalledWith("test_pack", "1.0.0");
    expect(mocks.reportTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        result: expect.objectContaining({
          outputs: expect.objectContaining({ ok: true, outputs: ["done"] }),
        }),
        failed: [],
      }),
      []
    );
    const last = states[states.length - 1];
    expect(last.tasks[0].status).toBe("completed");
    expect(last.runningTaskId).toBeNull();
  });

  it("skips execution when the claim is refused by another worker", async () => {
    const task = queuedTask();
    mocks.pullTasks.mockResolvedValue([task]);
    mocks.claimTask.mockResolvedValue(false); // server says already claimed

    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      workerId: "test-worker",
      store: fakeStore(),
      deps: { chat: vi.fn(), onSend: vi.fn(), onNotify: vi.fn() },
    });
    const states = [];
    engine.subscribe((s) => states.push(s));

    await engine.pull();

    // Never executed nor reported (would clobber the owning worker's result).
    expect(mocks.fetchSkill).not.toHaveBeenCalled();
    expect(mocks.reportTask).not.toHaveBeenCalled();
    const last = states[states.length - 1];
    expect(last.tasks[0].status).toBe("skipped");
    expect(last.runningTaskId).toBeNull();
  });

  it("uses a cached pack and skips the fetch when the library has it", async () => {
    const store = fakeStore();
    store.get.mockResolvedValue(TEST_PACK);
    mocks.pullTasks.mockResolvedValue([queuedTask()]);

    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      store,
      deps: {},
    });
    await engine.pull();

    expect(store.get).toHaveBeenCalledWith("skill_pack:test_pack:1.0.0");
    expect(mocks.fetchSkill).not.toHaveBeenCalled();
    expect(mocks.reportTask).toHaveBeenCalled();
  });

  it("reports a failed task when no skill pack is assigned", async () => {
    mocks.pullTasks.mockResolvedValue([queuedTask({ skill_pack_id: null })]);

    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      store: fakeStore(),
      deps: {},
    });
    await engine.pull();

    expect(mocks.reportTask).toHaveBeenCalledWith(
      "task-1",
      {},
      [],
      expect.stringContaining("no skill pack")
    );
  });

  it("reports a failed task when the skill pack is missing", async () => {
    mocks.fetchSkill.mockResolvedValue(null);
    mocks.pullTasks.mockResolvedValue([queuedTask()]);

    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      store: fakeStore(),
      deps: {},
    });
    await engine.pull();

    expect(mocks.reportTask).toHaveBeenCalledWith(
      "task-1",
      {},
      [],
      expect.stringContaining("not found")
    );
  });

  it("surfaces pull errors as lastError state without throwing", async () => {
    mocks.pullTasks.mockResolvedValue({ ok: false, error: "bad token" });

    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      store: fakeStore(),
      deps: {},
    });
    let state;
    engine.subscribe((s) => (state = s));
    await engine.pull();

    expect(state.lastError).toBe("bad token");
    expect(state.status).toBe("error");
  });

  it("proposes a skill pack through the worker client", async () => {
    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      workerId: "test-worker",
      store: fakeStore(),
      deps: {},
    });
    const pack = { name: "new_skill", version: "1.0.0", tools: ["outputs"] };
    const res = await engine.proposeSkill(pack);
    expect(mocks.proposeSkill).toHaveBeenCalledWith("test-worker", pack);
    expect(res.ok).toBe(true);
  });

  it("refreshes skills into state", async () => {
    const engine = createWorkerEngine({
      baseUrl: "http://127.0.0.1:8644",
      store: fakeStore(),
      deps: {},
    });
    await engine.refreshSkills();
    expect(engine.getState().skills).toHaveLength(1);
    expect(engine.getState().skills[0].name).toBe("test_pack");
  });
});
