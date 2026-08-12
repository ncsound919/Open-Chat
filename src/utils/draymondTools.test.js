import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  fetchSkill: vi.fn(),
  enqueueTask: vi.fn(),
  proposeSkill: vi.fn(),
  pullTasks: vi.fn(),
  claimTask: vi.fn(),
  reportTask: vi.fn(),
  heartbeat: vi.fn(),
}));

vi.mock("./workerClient.js", () => ({
  WorkerClient: class {
    constructor(baseUrl, token, workerId) {
      this.baseUrl = baseUrl;
      this.token = token;
      this.workerId = workerId;
    }
    listSkills = mocks.listSkills;
    fetchSkill = mocks.fetchSkill;
    enqueueTask = mocks.enqueueTask;
    proposeSkill = mocks.proposeSkill;
    pullTasks = mocks.pullTasks;
    claimTask = mocks.claimTask;
    reportTask = mocks.reportTask;
    heartbeat = mocks.heartbeat;
  },
}));

import { buildDraymondTools, DRAYMOND_TOOL_NAMES } from "./draymondTools.js";

function fakeStore() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
  };
}

const TEST_PACK = {
  name: "test_pack",
  version: "1.0.0",
  purpose: "test",
  tools: ["outputs"],
  outputs: ["done"],
  review_status: "approved",
  source: "draymond",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSkills.mockResolvedValue([
    { name: "test_pack", version: "1.0.0", purpose: "test", tools: ["outputs"] },
  ]);
  mocks.fetchSkill.mockResolvedValue(TEST_PACK);
  mocks.enqueueTask.mockResolvedValue({ ok: true, id: "task-9" });
});

function makeTools(opts = {}) {
  return buildDraymondTools({
    baseUrl: "http://127.0.0.1:8644",
    token: "secret",
    workerId: "test-worker",
    store: fakeStore(),
    orchestrator: opts.orchestrator ?? null,
    deps: {},
  });
}

describe("buildDraymondTools", () => {
  it("exposes the four tool schemas", () => {
    const { tools } = makeTools();
    expect(tools.map((t) => t.name)).toEqual([
      "list_skills",
      "run_skill",
      "run_chain",
      "enqueue_task",
    ]);
    expect(DRAYMOND_TOOL_NAMES).toContain("run_skill");
  });

  it("lists skills through the worker client", async () => {
    const { handler } = makeTools();
    const res = await handler("list_skills", {});
    expect(mocks.listSkills).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0].name).toBe("test_pack");
  });

  it("runs a skill pack on-device", async () => {
    const { handler } = makeTools();
    const res = await handler("run_skill", { skill: "test_pack:1.0.0", payload: {} });
    expect(mocks.fetchSkill).toHaveBeenCalledWith("test_pack", "1.0.0");
    expect(res.ok).toBe(true);
    expect(res.pack).toBe("test_pack:1.0.0");
    expect(res.output.outputs).toEqual({ ok: true, outputs: ["done"] });
  });

  it("returns a clear error for a missing skill pack", async () => {
    mocks.fetchSkill.mockResolvedValue(null);
    const { handler } = makeTools();
    const res = await handler("run_skill", { skill: "nope" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("enqueues a worker task", async () => {
    const { handler } = makeTools();
    const res = await handler("enqueue_task", {
      skill_pack_id: "test_pack:1.0.0",
      payload: { a: 1 },
    });
    expect(mocks.enqueueTask).toHaveBeenCalledWith("test_pack:1.0.0", { a: 1 }, undefined);
    expect(res.ok).toBe(true);
    expect(res.task_id).toBe("task-9");
  });

  it("runs a chain through the orchestrator client when provided", async () => {
    const executeChain = vi.fn().mockResolvedValue({ ok: true, chain_id: "c1" });
    const { handler } = makeTools({ orchestrator: { executeChain } });
    const res = await handler("run_chain", { slug: "research-pipeline", input: { q: "x" } });
    expect(executeChain).toHaveBeenCalledWith("research-pipeline", { q: "x" });
    expect(res.ok).toBe(true);
  });

  it("falls back to a raw POST for chains without an orchestrator client", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, chain_id: "c2" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { handler } = makeTools();
      const res = await handler("run_chain", { slug: "research-pipeline", input: {} });
      expect(res.ok).toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:8644/api/v1/chains");
      expect(init.method).toBe("POST");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects unknown tool names", async () => {
    const { handler } = makeTools();
    const res = await handler("mystery", {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown draymond tool/);
  });
});
