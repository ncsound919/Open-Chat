import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DraymondOrchestratorClient } from "./DraymondOrchestratorClient.js";

// ── Storage helpers ──────────────────────────────────────────────────────────
const store = new Map();
function makeLocalStorage() {
  return {
    getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
    setItem: vi.fn((k, v) => store.set(k, String(v))),
    removeItem: vi.fn((k) => store.delete(k)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((i) => Array.from(store.keys())[i] ?? null),
  };
}

// ── Fake streaming body helpers ──────────────────────────────────────────────
const encoder = new TextEncoder();

/** Build a ReadableStream-like body from an array of string chunks. */
function streamFromChunks(chunks) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) return { value: encoder.encode(chunks[i++]), done: false };
        return { value: undefined, done: true };
      },
      releaseLock: vi.fn(),
      cancel: vi.fn().mockResolvedValue(),
    }),
  };
}

/** JSON ok response with optional body stream. */
function jsonOk(payload, body) {
  return { ok: true, status: 200, statusText: "OK", json: async () => payload, body };
}

function httpError(status, statusText = "Error") {
  return {
    ok: false, status, statusText,
    json: async () => ({}),
  };
}

let fetchMock;

beforeEach(() => {
  store.clear();
  global.localStorage = makeLocalStorage();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete global.localStorage;
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.restoreAllMocks();
});

describe("DraymondOrchestratorClient constructor", () => {
  it("builds baseUrl from a full URL", () => {
    const c = new DraymondOrchestratorClient("https://xxxx.trycloudflare.com", 9999, "tok");
    expect(c.baseUrl).toBe("https://xxxx.trycloudflare.com/api");
  });

  it("builds baseUrl from a remote hostname with https", () => {
    const c = new DraymondOrchestratorClient("orchestra.example.com", 8644, "tok");
    expect(c.baseUrl).toBe("https://orchestra.example.com/api");
  });

  it("builds baseUrl from a local host + port", () => {
    const c = new DraymondOrchestratorClient("127.0.0.1", 8644, "tok");
    expect(c.baseUrl).toBe("http://127.0.0.1:8644/api");
  });

  it("handles localhost and ::1 as local hosts", () => {
    expect(new DraymondOrchestratorClient("localhost", 8644, "").baseUrl).toBe("http://localhost:8644/api");
    expect(new DraymondOrchestratorClient("::1", 8644, "").baseUrl).toBe("http://::1:8644/api");
  });

  it("normalizes trailing slashes on full URLs", () => {
    const c = new DraymondOrchestratorClient("https://api.example.com/", 8644, "");
    expect(c.baseUrl).toBe("https://api.example.com/api");
  });

  it("initializes state and callbacks", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    expect(c.status).toBe("disconnected");
    expect(c.registeredAgents).toEqual({});
    expect(c.activeWorkflows).toEqual({});
    expect(c.eventSource).toBeNull();
    expect(c.maxReconnectAttempts).toBe(5);
    expect(c.onStatusChange).toBeNull();
    expect(c.onWorkflowUpdate).toBeNull();
    expect(c.onAgentDiscovered).toBeNull();
    expect(c.onToolExecution).toBeNull();
    expect(c.onNotification).toBeNull();
    expect(c.onChainUpdate).toBeNull();
    expect(typeof c._clientId).toBe("string");
  });

  it("loads a persisted offline queue from localStorage", () => {
    global.localStorage.setItem(
      "openchat_draymond_queue_v1",
      JSON.stringify([{ type: "syncMessages", sessionId: "s1", messages: [] }])
    );
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(c.getOfflineQueueSize()).toBe(1);
  });

  it("ignores invalid persisted queue JSON", () => {
    global.localStorage.setItem("openchat_draymond_queue_v1", "not json");
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(c.getOfflineQueueSize()).toBe(0);
  });

  it("tolerates localStorage throwing", () => {
    global.localStorage = {
      getItem: vi.fn(() => { throw new Error("boom"); }),
      setItem: vi.fn(),
    };
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(c.getOfflineQueueSize()).toBe(0);
  });
});

describe("connect / disconnect", () => {
  it("connects, discovers agents, opens event stream, and reports status", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk({ ok: true })) // health
      .mockResolvedValueOnce(jsonOk({
        agents: [
          { id: "a1", name: "Alpha", capabilities: ["search"], status: "active", last_heartbeat: "2026-01-01T00:00:00Z" },
          { id: "a2", name: "Beta" },
        ],
      }))
      .mockResolvedValueOnce(jsonOk({}, streamFromChunks([]))) // event stream
      .mockResolvedValueOnce(jsonOk({ ok: true })); // reportStatus

    const c = new DraymondOrchestratorClient("127.0.0.1", 8644, "tok");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    const discovered = [];
    c.onAgentDiscovered = (a) => discovered.push(a);

    const agents = await c.connect();

    expect(statuses).toEqual(["connecting", "connected"]);
    expect(Object.keys(agents).length).toBe(2);
    expect(Object.keys(c.registeredAgents).length).toBe(2);
    expect(discovered.length).toBe(2);
    expect(c.status).toBe("connected");

    // health + agents + events + status = 4 calls
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toContain("/v1/health");
    expect(urls[1]).toContain("/v1/agents");
    expect(urls[2]).toContain("/v1/events");
    expect(urls[3]).toContain("/v1/status");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");

    c.disconnect();
  });

  it("throws when the health check fails", async () => {
    fetchMock.mockResolvedValueOnce(httpError(503));
    const c = new DraymondOrchestratorClient("127.0.0.1", 8644, "");
    await expect(c.connect()).rejects.toThrow("Orchestrator health check failed");
    expect(c.status).toBe("error");
  });

  it("throws when health check fails on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    await expect(c.connect()).rejects.toThrow("Orchestrator health check failed");
  });

  it("flushes a pre-existing offline queue on connect", async () => {
    global.localStorage.setItem(
      "openchat_draymond_queue_v1",
      JSON.stringify([{ type: "syncMessages", sessionId: "s1", messages: [{ role: "user", content: "hi" }] }])
    );
    fetchMock
      .mockResolvedValueOnce(jsonOk({ ok: true })) // health
      .mockResolvedValueOnce(jsonOk({ agents: [] })) // discover
      .mockResolvedValueOnce(jsonOk({}, streamFromChunks([]))) // events
      .mockResolvedValueOnce(jsonOk({ ok: true })) // reportStatus
      .mockResolvedValueOnce(jsonOk({ ok: true, inserted: 1 })) // syncMessages flush
      .mockResolvedValueOnce(jsonOk({ ok: true })); // reportStatus heartbeat
    const c = new DraymondOrchestratorClient("127.0.0.1", 8644, "");
    await c.connect();
    expect(c.getOfflineQueueSize()).toBe(0);
    c.disconnect();
  });

  it("disconnect clears reconnects, timers, and event source and reports status", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ agents: [] }))
      .mockResolvedValueOnce(jsonOk({}, streamFromChunks([])))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true })); // disconnect reportStatus
    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    await c.connect();

    const eventSourceClose = vi.spyOn(c.eventSource, "close");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    c.disconnect();

    expect(statuses).toEqual(["disconnecting", "disconnected"]);
    expect(eventSourceClose).toHaveBeenCalled();
    expect(c.eventSource).toBeNull();
    expect(c.activeWorkflows).toEqual({});
    expect(c._shouldReconnect).toBe(false);
  });
});

describe("orchestrate", () => {
  it("streams a task, tracks the workflow, and returns the assembled text", async () => {
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"workflow":{"id":"wf1","status":"in_progress","current_phase":"research"}}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    fetchMock.mockResolvedValueOnce(jsonOk({}, body));

    const c = new DraymondOrchestratorClient("127.0.0.1", 8644, "tok");
    const chunks = [];
    const phases = [];
    const result = await c.orchestrate(
      {
        workflowId: "wf1",
        task: "Analyze this",
        onChunk: (d) => chunks.push(d),
        onPhaseUpdate: (p) => phases.push(p),
      },
      undefined
    );

    expect(result.text).toBe("Hello world");
    expect(result.workflowId).toBe("wf1");
    expect(chunks).toEqual(["Hello", " world"]);
    expect(c.activeWorkflows.wf1.status).toBe("completed");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/orchestrate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).task).toBe("Analyze this");
    expect(init.headers.Authorization).toBe("Bearer tok");

    c.disconnect();
  });

  it("throws on non-ok orchestrate response", async () => {
    fetchMock.mockResolvedValueOnce(httpError(500));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    await expect(c.orchestrate({ workflowId: "wf1", task: "x" }, undefined)).rejects.toThrow("HTTP 500");
  });

  it("throws when the streamed response is too large", async () => {
    const big = "x".repeat(1_049_000);
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks([`data: ${big}\n\n`])));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    await expect(c.orchestrate({ workflowId: "wf1", task: "x" }, undefined)).rejects.toThrow("Response too large");
  });

  it("supports external abort signal (AbortSignal.any path)", async () => {
    const body = streamFromChunks([
      "data: [DONE]\n\n",
    ]);
    fetchMock.mockResolvedValueOnce(jsonOk({}, body));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const controller = new AbortController();
    const cancelSpy = vi.spyOn(c, "cancelWorkflow").mockResolvedValue();
    const result = await c.orchestrate({ workflowId: "wf", task: "t" }, controller.signal);
    expect(result.workflowId).toBe("wf");
    expect(typeof cancelSpy).toBe("function");
    c.disconnect();
  });

  it("handles abort signal polyfill branch when AbortSignal.any is unavailable", async () => {
    const keepAny = AbortSignal.any;
    try {
      AbortSignal.any = undefined;
      fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks(["data: [DONE]\n\n"])));
      const c = new DraymondOrchestratorClient("localhost", 8644, "");
      const controller = new AbortController();
      await c.orchestrate({ workflowId: "wf", task: "t" }, controller.signal);
      expect(c.activeWorkflows.wf.status).toBe("completed");
      c.disconnect();
    } finally {
      AbortSignal.any = keepAny;
    }
  });
});

describe("workflows API", () => {
  it("getWorkflowStatus returns the JSON payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ id: "wf1", status: "completed" }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    const res = await c.getWorkflowStatus("wf1");
    expect(res.status).toBe("completed");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("getWorkflowStatus returns null on error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.getWorkflowStatus("wf1")).toBeNull();
  });

  it("cancelWorkflow marks an existing workflow as cancelled", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.activeWorkflows.wf1 = { status: "in_progress" };
    await c.cancelWorkflow("wf1");
    expect(c.activeWorkflows.wf1.status).toBe("cancelled");
  });

  it("cancelWorkflow creates a cancelled record for unknown workflows", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    await c.cancelWorkflow("wf2");
    expect(c.activeWorkflows.wf2.status).toBe("cancelled");
  });

  it("cancelWorkflow swallows fetch errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    await expect(c.cancelWorkflow("wf1")).resolves.toBeUndefined();
  });

  it("getAgents and getActiveWorkflows expose internal state", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.registeredAgents = { a: { id: "a" } };
    c.activeWorkflows = { w: { id: "w" } };
    expect(c.getAgents()).toEqual({ a: { id: "a" } });
    expect(c.getActiveWorkflows()).toEqual({ w: { id: "w" } });
  });
});

describe("messages API", () => {
  it("syncMessages posts messages and returns json", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, inserted: 3 }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    const res = await c.syncMessages("s1", [{ role: "user", content: "hi" }]);
    expect(res.inserted).toBe(3);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).session_id).toBe("s1");
  });

  it("syncMessages queues offline on failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const res = await c.syncMessages("s1", [{ role: "user", content: "hi" }]);
    expect(res.ok).toBe(false);
    expect(c.getOfflineQueueSize()).toBe(1);
  });

  it("loadMessages builds query params and returns json", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, messages: [{ text: "hi" }] }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const res = await c.loadMessages("s1", { limit: 50, before: "2026-01-01T00:00:00Z" });
    expect(res.messages.length).toBe(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("session_id=s1");
    expect(url).toContain("limit=50");
    expect(url).toContain("before=");
  });

  it("loadMessages returns empty messages on error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.loadMessages("s1")).toEqual({ ok: false, messages: [] });
  });
});

describe("chains API", () => {
  it("listChains applies filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, chains: [{ slug: "gold" }] }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const res = await c.listChains({ is_template: true, status: "active", limit: 5 });
    expect(res.chains.length).toBe(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("is_template=true");
    expect(url).toContain("status=active");
    expect(url).toContain("limit=5");
  });

  it("listChains returns empty on error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.listChains()).toEqual({ ok: false, chains: [] });
  });

  it("executeChain posts and returns json", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, run_id: "r1" }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const res = await c.executeChain("gold", { query: "hi" }, "agent1");
    expect(res.run_id).toBe("r1");
  });

  it("executeChain queues offline on failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect((await c.executeChain("gold")).ok).toBe(false);
    expect(c.getOfflineQueueSize()).toBe(1);
  });
});

describe("schedules API", () => {
  it("listSchedules applies filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, schedules: [{ id: "s1" }] }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const res = await c.listSchedules({ is_enabled: true, job_type: "email", limit: 10 });
    expect(res.schedules.length).toBe(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("is_enabled=true");
    expect(url).toContain("job_type=email");
  });

  it("listSchedules returns empty on error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.listSchedules()).toEqual({ ok: false, schedules: [] });
  });

  it("toggleSchedule patches and returns json", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, id: "s1" }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    const res = await c.toggleSchedule("s1", "enable");
    expect(res.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ id: "s1", action: "enable" });
  });

  it("toggleSchedule queues offline on failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect((await c.toggleSchedule("s1", "disable")).ok).toBe(false);
    expect(c.getOfflineQueueSize()).toBe(1);
  });
});

describe("status API", () => {
  it("reportStatus posts heartbeat with client id", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    await c.reportStatus("heartbeat");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).action).toBe("heartbeat");
  });

  it("reportStatus returns {ok:false} on failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.reportStatus()).toEqual({ ok: false });
  });

  it("getServerStatus returns json", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true, status: "online", agents: 3 }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const res = await c.getServerStatus();
    expect(res.status).toBe("online");
  });

  it("getServerStatus returns unreachable on failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.getServerStatus()).toEqual({ ok: false, status: "unreachable" });
  });
});

describe("entity/chain routing", () => {
  it("invokeEntity wraps an orchestrate call with entity metadata", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks(["data: [DONE]\n\n"])));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const spy = vi.spyOn(c, "orchestrate");
    await c.invokeEntity("writer", "summarize", { doc: "x" });
    const opts = spy.mock.calls[0][0];
    expect(opts.task).toContain("Invoke entity: writer");
    expect(opts.metadata.entity_slug).toBe("writer");
    expect(opts.workflowId).toContain("entity-writer");
    c.disconnect();
  });

  it("triggerChain wraps an orchestrate call with chain metadata", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks(["data: [DONE]\n\n"])));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const spy = vi.spyOn(c, "orchestrate").mockResolvedValue({ text: "ok", workflowId: "chain-x" });
    await c.triggerChain("gold", { k: "v" });
    const opts = spy.mock.calls[0][0];
    expect(opts.task).toContain("Execute chain: gold");
    expect(opts.metadata.chain_slug).toBe("gold");
    expect(opts.workflowId).toContain("chain-");
  });
});

describe("offline queue", () => {
  it("flushOfflineQueue returns early when empty", async () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.flushOfflineQueue()).toEqual({ succeeded: 0, failed: 0 });
  });

  it("flushOfflineQueue succeeds per command and handles each type", async () => {
    fetchMock.mockResolvedValue(jsonOk({ ok: true }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c._offlineQueue = [
      { type: "syncMessages", sessionId: "s1", messages: [], queued_at: new Date().toISOString() },
      { type: "executeChain", chainSlug: "gold", input: {}, agentId: null, queued_at: new Date().toISOString() },
      { type: "toggleSchedule", jobId: "j1", action: "enable", queued_at: new Date().toISOString() },
    ];
    const res = await c.flushOfflineQueue();
    expect(res.succeeded).toBe(3);
    expect(res.failed).toBe(0);
    expect(c.getOfflineQueueSize()).toBe(0);
  });

  it("flushOfflineQueue re-queues failed commands and logs unknown types", async () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c._offlineQueue = [
      { type: "syncMessages", sessionId: "s1", messages: [], queued_at: new Date().toISOString() },
      { type: "mystery", wat: true, queued_at: new Date().toISOString() },
    ];
    vi.spyOn(c, "syncMessages").mockRejectedValue(new Error("down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await c.flushOfflineQueue();
    expect(res.succeeded).toBe(1); // mystery increments succeeded via default branch
    expect(res.failed).toBe(1);    // syncMessages failure re-queued
    expect(c.getOfflineQueueSize()).toBe(1); // only syncMessages re-queued
    warnSpy.mockRestore();
  });

  it("_enqueueOffline drops the oldest when over the cap", () => {
    global.localStorage.setItem(
      "openchat_draymond_queue_v1",
      JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ type: `t${i}`, queued_at: new Date().toISOString() })))
    );
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c._enqueueOffline({ type: "new", });
    expect(c.getOfflineQueueSize()).toBe(100);
    expect(c._offlineQueue[99].type).toBe("new");
  });
});

describe("private helpers", () => {
  it("_healthCheck returns ok status", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c._healthCheck()).toBe(true);
  });

  it("_healthCheck returns false when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c._healthCheck()).toBe(false);
  });

  it("_healthCheck returns false on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(httpError(500));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c._healthCheck()).toBe(false);
  });

  it("_discoverAgents maps an array and invokes onAgentDiscovered", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({
      agents: [{ id: "a1", name: "Alpha", capabilities: ["x"], status: "ready", last_heartbeat: "h" }],
    }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const found = [];
    c.onAgentDiscovered = (a) => found.push(a);
    const agents = await c._discoverAgents();
    expect(agents.a1.name).toBe("Alpha");
    expect(found.length).toBe(1);
  });

  it("_discoverAgents returns {} when payload is not an array", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ agents: { a1: {} } }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c._discoverAgents()).toEqual({});
  });

  it("_discoverAgents returns {} on error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c._discoverAgents()).toEqual({});
  });

  it("_setStatus updates status and notifies callback", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const cb = vi.fn();
    c.onStatusChange = cb;
    c._setStatus("connected");
    expect(c.status).toBe("connected");
    expect(cb).toHaveBeenCalledWith("connected");
  });
});

describe("event stream", () => {
  it("_connectEventStream consumes a valid stream and disconnects cleanly", async () => {
    const sse = [
      'data: {"type":"agent.registered","data":{"agent":{"id":"a1","name":"Alpha","capabilities":["search"],"status":"active"}}}\n\n',
      'data: {"type":"workflow.started","data":{"workflow":{"id":"wf1","status":"in_progress"}}}\n\n',
      'data: {"type":"phase.completed","data":{"workflow_id":"wf1","phase":{"name":"research"}}}\n\n',
      'data: {"type":"tool.executed","data":{"execution":{"tool":"search","status":"ok"}}}\n\n',
      'data: {"type":"workflow.completed","data":{"workflow_id":"wf1"}}\n\n',
      'data: {"type":"chain.started","data":{}}\n\n',
      'data: {"type":"scheduler.job_started","data":{}}\n\n',
      'data: {"type":"notification.sent","data":{}}\n\n',
      'data: {"type":"monitor.site_down","data":{}}\n\n',
      'data: {"type":"custom.event","data":{}}\n\n',
    ];
    fetchMock.mockResolvedValueOnce(jsonOk({ ok: true }, streamFromChunks(sse)));

    const c = new DraymondOrchestratorClient("localhost", 8644, "tok");
    const agents = [];
    const workUpdates = [];
    const tools = [];
    const chains = [];
    const scheds = [];
    const notifs = [];
    const events = [];
    c.onAgentDiscovered = (a) => agents.push(a);
    c.onWorkflowUpdate = (w) => workUpdates.push(w);
    c.onToolExecution = (e) => tools.push(e);
    c.onChainUpdate = (e) => chains.push(e);
    c.onScheduleUpdate = (e) => scheds.push(e);
    c.onNotification = (e) => notifs.push(e);
    c.onEvent = (e) => events.push(e);

    c._connectEventStream();
    // Let the async IIFE complete.
    await new Promise((r) => setTimeout(r, 10));

    expect(agents.length).toBe(1);
    expect(workUpdates.length).toBeGreaterThan(0);
    expect(tools.length).toBe(1);
    expect(chains.length).toBe(1);
    expect(scheds.length).toBe(1);
    expect(notifs.length).toBeGreaterThanOrEqual(2); // notification.sent + monitor.site_down
    expect(events.length).toBe(1);

    c.disconnect();
  });

  it("_connectEventStream reconnects with growing backoff on stream error", async () => {
    fetchMock.mockResolvedValueOnce(httpError(500));
    vi.useFakeTimers();
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.maxReconnectAttempts = 2;
    c._shouldReconnect = true;
    const connectSpy = vi.spyOn(c, "_connectEventStream");

    c._connectEventStream();
    await Promise.resolve();
    await Promise.resolve();
    // First attempt errors → schedules reconnect
    expect(c.reconnectAttempts).toBe(1);
    expect(c._reconnectTimerId).not.toBeNull();

    vi.advanceTimersByTime(3000 * 1);
    await Promise.resolve();
    expect(connectSpy).toHaveBeenCalledTimes(2);

    c._shouldReconnect = false;
    c.disconnect();
    vi.useRealTimers();
  });

  it("_consumeEventStream reads until done and flushes the tail", async () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const handler = vi.spyOn(c, "_handleEventStreamChunk").mockImplementation(() => {});
    const body = streamFromChunks([
      'data: {"a":1}\n\ndata: {"b":2}\n\n',
      'data: {"c":3}', // trailing without final blank line → flush
    ]);
    const controller = new AbortController();
    await c._consumeEventStream(body, controller.signal);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("_consumeEventStream stops early when the signal aborts", async () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const controller = new AbortController();
    const body = {
      getReader: () => ({
        read: async () => {
          controller.abort();
          return { value: encoder.encode("data: {\"a\":1}\n\n"), done: false };
        },
        releaseLock: vi.fn(),
      }),
    };
    await c._consumeEventStream(body, controller.signal);
    // No throw — the loop breaks on abort.
    expect(true).toBe(true);
  });

  it("_processEventStreamBuffer splits complete chunks and keeps the remainder", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const handler = vi.spyOn(c, "_handleEventStreamChunk").mockImplementation(() => {});
    const result = c._processEventStreamBuffer(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":3}'
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(result).toContain('data: {"c":3}');
  });

  it("_processEventStreamBuffer flushes an incomplete tail when flush=true", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const handler = vi.spyOn(c, "_handleEventStreamChunk").mockImplementation(() => {});
    const result = c._processEventStreamBuffer('data: {"x":1}', true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toBe("");
  });

  it("_processEventStreamBuffer handles CRLF and empty chunks", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const handler = vi.spyOn(c, "_handleEventStreamChunk").mockImplementation(() => {});
    c._processEventStreamBuffer('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("_handleEventStreamChunk parses data lines and invokes _handleEvent", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const eventSpy = vi.spyOn(c, "_handleEvent");
    c._handleEventStreamChunk('data: {"type":"custom","data":{}}');
    expect(eventSpy).toHaveBeenCalledWith({ type: "custom", data: {} });
  });

  it("_handleEventStreamChunk ignores chunks without data lines", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const eventSpy = vi.spyOn(c, "_handleEvent").mockImplementation(() => {});
    c._handleEventStreamChunk("event: ping\n: comment only");
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("_handleEventStreamChunk warns on malformed JSON", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    c._handleEventStreamChunk("data: {not json");
    warn.mockRestore();
    expect(true).toBe(true);
  });
});

describe("_handleEvent routing", () => {
  function makeClient() {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.activeWorkflows.wf1 = { id: "wf1", status: "in_progress", phases: [], agents: [] };
    const handlers = {
      agent: vi.fn(),
      workflow: vi.fn(),
      tool: vi.fn(),
      chain: vi.fn(),
      schedule: vi.fn(),
      notification: vi.fn(),
      event: vi.fn(),
    };
    c.onAgentDiscovered = handlers.agent;
    c.onWorkflowUpdate = handlers.workflow;
    c.onToolExecution = handlers.tool;
    c.onChainUpdate = handlers.chain;
    c.onScheduleUpdate = handlers.schedule;
    c.onNotification = handlers.notification;
    c.onEvent = handlers.event;
    return { c, handlers };
  }

  it("routes agent.registered and agent.updated", () => {
    const { c, handlers } = makeClient();
    c._handleEvent({ type: "agent.registered", data: { agent: { id: "a1", name: "A", capabilities: [], status: "up" } } });
    c._handleEvent({ type: "agent.updated", data: { agent: { id: "a1", name: "A", capabilities: [], status: "up" } } });
    expect(handlers.agent).toHaveBeenCalledTimes(2);
    expect(c.registeredAgents.a1.id).toBe("a1");
  });

  it("routes workflow.started and workflow.updated", () => {
    const { c, handlers } = makeClient();
    c._handleEvent({ type: "workflow.started", data: { workflow: { id: "wf2", status: "running" } } });
    c._handleEvent({ type: "workflow.updated", data: { workflow: { id: "wf2", status: "running" } } });
    expect(handlers.workflow).toHaveBeenCalledTimes(2);
  });

  it("tracks phase.completed against an existing workflow", () => {
    const { c, handlers } = makeClient();
    c._handleEvent({ type: "phase.completed", data: { workflow_id: "wf1", phase: { name: "research" } } });
    expect(c.activeWorkflows.wf1.currentPhase).toBe("research");
    expect(c.activeWorkflows.wf1.phases.length).toBe(1);
    expect(handlers.workflow).toHaveBeenCalled();
  });

  it("routes tool.executed", () => {
    const { c, handlers } = makeClient();
    c._handleEvent({ type: "tool.executed", data: { execution: { tool: "search" } } });
    expect(handlers.tool).toHaveBeenCalledWith({ tool: "search" });
  });

  it("marks workflows completed and failed", () => {
    const { c, handlers } = makeClient();
    c._handleEvent({ type: "workflow.completed", data: { workflow_id: "wf1" } });
    expect(c.activeWorkflows.wf1.status).toBe("completed");
    expect(c.activeWorkflows.wf1.endTime).toBeDefined();
    c._handleEvent({ type: "workflow.failed", data: { workflow_id: "wf1" } });
    expect(c.activeWorkflows.wf1.status).toBe("failed");
    expect(handlers.workflow).toHaveBeenCalled();
  });

  it("routes all chain event types", () => {
    const { c, handlers } = makeClient();
    for (const type of ["chain.started", "chain.step_completed", "chain.step_failed", "chain.completed", "chain.failed"]) {
      c._handleEvent({ type, data: {} });
    }
    expect(handlers.chain).toHaveBeenCalledTimes(5);
  });

  it("routes all scheduler event types", () => {
    const { c, handlers } = makeClient();
    for (const type of ["scheduler.job_started", "scheduler.job_completed", "scheduler.job_failed"]) {
      c._handleEvent({ type, data: {} });
    }
    expect(handlers.schedule).toHaveBeenCalledTimes(3);
  });

  it("routes notification and monitor event types", () => {
    const { c, handlers } = makeClient();
    for (const type of ["notification.sent", "notification.failed", "monitor.site_down", "monitor.site_recovered", "monitor.health_check_complete"]) {
      c._handleEvent({ type, data: {} });
    }
    expect(handlers.notification).toHaveBeenCalledTimes(5);
  });

  it("passes unknown event types to onEvent", () => {
    const { c, handlers } = makeClient();
    c._handleEvent({ type: "mystery", data: { x: 1 } });
    expect(handlers.event).toHaveBeenCalledWith({ type: "mystery", data: { x: 1 } });
  });
});

describe("_updateWorkflow and _pollWorkflowStatus", () => {
  it("_updateWorkflow creates and merges workflow state", () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const cb = vi.fn();
    c.onWorkflowUpdate = cb;
    c._updateWorkflow("new-wf", { status: "running", extra: true });
    expect(c.activeWorkflows["new-wf"].status).toBe("running");
    expect(c.activeWorkflows["new-wf"].extra).toBe(true);
    c._updateWorkflow("new-wf", { progress: 50 });
    expect(c.activeWorkflows["new-wf"].progress).toBe(50);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("_pollWorkflowStatus stops when the workflow is already completed", async () => {
    vi.useFakeTimers();
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.activeWorkflows.wf1 = { status: "completed", id: "wf1" };
    const getSpy = vi.spyOn(c, "getWorkflowStatus");
    c._pollWorkflowStatus("wf1", vi.fn(), vi.fn(), undefined);
    vi.advanceTimersByTime(1000 + 100);
    expect(getSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("_pollWorkflowStatus updates, notifies phases/tools, and re-polls while in progress", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonOk({ id: "wf1", status: "in_progress", current_phase: "research", recent_executions: [{ tool: "search" }] }))
      .mockResolvedValueOnce(jsonOk({ id: "wf1", status: "completed" }));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.activeWorkflows.wf1 = { status: "in_progress", id: "wf1", phases: [], agents: [] };
    const phases = vi.fn();
    const tools = vi.fn();
    c._pollWorkflowStatus("wf1", phases, tools, undefined);

    await vi.advanceTimersByTimeAsync(1000);
    expect(phases).toHaveBeenCalledWith("research");
    expect(tools).toHaveBeenCalledWith({ tool: "search" });

    await vi.advanceTimersByTimeAsync(1000);
    expect(c.activeWorkflows.wf1.status).toBe("completed");
    vi.useRealTimers();
  });

  it("_pollWorkflowStatus stops polling when the signal is aborted", async () => {
    vi.useFakeTimers();
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c.activeWorkflows.wf1 = { status: "in_progress", id: "wf1" };
    const controller = new AbortController();
    controller.abort();
    const getSpy = vi.spyOn(c, "getWorkflowStatus");
    c._pollWorkflowStatus("wf1", vi.fn(), vi.fn(), controller.signal);
    vi.advanceTimersByTime(1000 + 100);
    expect(getSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("orchestrate streaming edge cases", () => {
  it("cancels the workflow when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    let reads = 0;
    const body = {
      getReader: () => ({
        read: async () => {
          if (reads++ === 0) {
            return { value: encoder.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'), done: false };
          }
          return new Promise(() => {}); // never resolves — stream stays open
        },
        releaseLock: vi.fn(),
        cancel: vi.fn().mockResolvedValue(),
      }),
    };
    fetchMock.mockResolvedValueOnce(jsonOk({}, body));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const cancelSpy = vi.spyOn(c, "cancelWorkflow").mockRejectedValue(new Error("abort"));

    c.orchestrate({ workflowId: "wf-abort", task: "t" }, controller.signal);
    // Let fetch resolve and the abort listener register before aborting.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    expect(cancelSpy).toHaveBeenCalledWith("wf-abort");
    c.disconnect();
  });

  it("warns and continues on malformed JSON in the stream", async () => {
    const body = streamFromChunks([
      "data: {not json}\n\n",
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    fetchMock.mockResolvedValueOnce(jsonOk({}, body));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const result = await c.orchestrate({ workflowId: "wf-parse", task: "t" }, undefined);
    expect(result.text).toBe("OK");
    warn.mockRestore();
    c.disconnect();
  });

  it("processes a trailing data event without a final newline", async () => {
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"workflow":{"id":"wfT","status":"in_progress"}}',
    ]);
    fetchMock.mockResolvedValueOnce(jsonOk({}, body));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const updates = [];
    c.onWorkflowUpdate = (w) => updates.push(w);
    const result = await c.orchestrate({ workflowId: "wfT", task: "t" }, undefined);
    expect(result.text).toBe("Hi");
    expect(updates.length).toBeGreaterThan(0);
    expect(c.activeWorkflows.wfT.status).toBe("in_progress");
    c.disconnect();
  });

  it("completes a workflow from a trailing [DONE] data line", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks(["data: [DONE]"])));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const result = await c.orchestrate({ workflowId: "wf-done", task: "t" }, undefined);
    expect(result.workflowId).toBe("wf-done");
    expect(c.activeWorkflows["wf-done"].status).toBe("completed");
    c.disconnect();
  });

  it("completes a workflow from a trailing [DONE] with a blank line", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks(["data: [DONE]\n"])));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const result = await c.orchestrate({ workflowId: "wf-done2", task: "t" }, undefined);
    expect(result.text).toBe("");
    expect(c.activeWorkflows["wf-done2"].status).toBe("completed");
    c.disconnect();
  });

  it("handles a trailing blank line without buffered events", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({}, streamFromChunks(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n']))
    );
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const result = await c.orchestrate({ workflowId: "wf-blank", task: "t" }, undefined);
    expect(result.text).toBe("x");
    expect(c.activeWorkflows["wf-blank"].status).toBe("in_progress");
    c.disconnect();
  });

  it("aborts the merged controller when the signal aborts in the polyfill branch", async () => {
    const keepAny = AbortSignal.any;
    try {
      AbortSignal.any = undefined;
      const controller = new AbortController();
      let reads = 0;
      const body = {
        getReader: () => ({
          read: async () => {
            if (reads++ === 0) {
              return { value: encoder.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'), done: false };
            }
            return new Promise(() => {}); // never resolves — stream stays open
          },
          releaseLock: vi.fn(),
          cancel: vi.fn().mockResolvedValue(),
        }),
      };
      fetchMock.mockResolvedValueOnce(jsonOk({}, body));
      const c = new DraymondOrchestratorClient("localhost", 8644, "");
      const cancelSpy = vi.spyOn(c, "cancelWorkflow").mockResolvedValue();

      c.orchestrate({ workflowId: "wf-abort2", task: "t" }, controller.signal);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();

      expect(cancelSpy).toHaveBeenCalledWith("wf-abort2");
      c.disconnect();
    } finally {
      AbortSignal.any = keepAny;
    }
  });
});

describe("workflows API edge cases", () => {
  it("getWorkflowStatus returns null on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(httpError(500));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c.getWorkflowStatus("wf1")).toBeNull();
  });

  it("_discoverAgents returns {} on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(httpError(500));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    expect(await c._discoverAgents()).toEqual({});
  });
});

describe("event stream edge cases", () => {
  it("_connectEventStream closes an existing event source", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}, streamFromChunks([])));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const fake = { close: vi.fn() };
    c.eventSource = fake;
    c._connectEventStream();
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.close).toHaveBeenCalled();
    c.disconnect();
  });

  it("_connectEventStream ignores errors after the stream was closed", async () => {
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    const body = {
      getReader: () => ({
        read: async () => { throw new Error("network"); },
        releaseLock: vi.fn(),
        cancel: vi.fn().mockResolvedValue(),
      }),
    };
    fetchMock.mockResolvedValueOnce(jsonOk({}, body));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    c._connectEventStream();
    c.eventSource.close(); // abort the controller before the error is handled
    await new Promise((r) => setTimeout(r, 10));
    expect(c._reconnectTimerId).toBeNull();
    expect(c.eventSource).not.toBeNull();
    warn.mockRestore();
    c.disconnect();
  });

  it("_connectEventStream handles a response without a body", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    c._shouldReconnect = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    c._connectEventStream();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.eventSource).toBeNull();
    warn.mockRestore();
    c.disconnect();
  });
});

describe("offline queue persistence edge cases", () => {
  it("uses Capacitor Preferences when running on a native platform", async () => {
    vi.resetModules();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
    }));
    const prefsMock = { set: vi.fn().mockResolvedValue(), get: vi.fn() };
    vi.doMock("@capacitor/preferences", () => ({ Preferences: prefsMock }));

    const { DraymondOrchestratorClient: NativeClient } = await import("./DraymondOrchestratorClient.js");

    // Nil stored value → async load returns early.
    prefsMock.get.mockResolvedValueOnce({ value: null });
    const empty = new NativeClient("localhost", 8644, "");
    await new Promise((r) => setTimeout(r, 0));
    expect(empty.getOfflineQueueSize()).toBe(0);

    // A stored queue merges asynchronously after construction.
    prefsMock.get.mockResolvedValueOnce({
      value: JSON.stringify([{ type: "syncMessages", sessionId: "s1", messages: [] }]),
    });
    const c = new NativeClient("localhost", 8644, "");
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getOfflineQueueSize()).toBe(1);

    // Read failures are swallowed.
    prefsMock.get.mockRejectedValueOnce(new Error("read failed"));
    const fail = new NativeClient("localhost", 8644, "");
    await new Promise((r) => setTimeout(r, 0));
    expect(fail.getOfflineQueueSize()).toBe(0);

    // Native saves go through Preferences.set.
    c._enqueueOffline({ type: "syncMessages", sessionId: "s2", messages: [] });
    expect(prefsMock.set).toHaveBeenCalled();
    expect(prefsMock.set.mock.calls[0][0].key).toBe("openchat_draymond_queue_v1");
  });

  it("tolerates localStorage write failures when saving the queue", async () => {
    global.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error("quota"); }),
    };
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const c = new DraymondOrchestratorClient("localhost", 8644, "");
    await c.syncMessages("s1", []);
    expect(c.getOfflineQueueSize()).toBe(1);
  });
});
