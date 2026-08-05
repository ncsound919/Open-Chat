import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// storage.js reads isNative from platform.js (false in the test env), so it
// uses localStorage. Node has no localStorage — provide a minimal stub.
const store = new Map();

function makeLocalStorage() {
  return {
    getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
    setItem: vi.fn((k, v) => store.set(k, String(v))),
    removeItem: vi.fn((k) => store.delete(k)),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((i) => Array.from(store.keys())[i] ?? null),
  };
}

let storageModule;

beforeEach(() => {
  store.clear();
  global.localStorage = makeLocalStorage();
  vi.resetModules();
  storageModule = require("./storage.js");
});

afterEach(() => {
  delete global.localStorage;
  vi.restoreAllMocks();
});

describe("storage load/save round-trip", () => {
  it("saves and loads history", () => {
    const data = { bot1: [{ id: "1", text: "hi" }] };
    storageModule.saveHist(data);
    expect(storageModule.loadHist()).toEqual(data);
  });

  it("returns {} for empty or corrupted history", () => {
    expect(storageModule.loadHist()).toEqual({});
    global.localStorage.setItem("openchat_hist_v1", "not json {");
    expect(storageModule.loadHist()).toEqual({});
    global.localStorage.setItem("openchat_hist_v1", JSON.stringify([1, 2]));
    expect(storageModule.loadHist()).toEqual({});
  });

  it("saves and loads bots, returning defaults when empty", () => {
    const bots = [{ id: "x", name: "X", protocol: "hermes" }];
    storageModule.saveBots(bots);
    expect(storageModule.loadBots()).toEqual(bots);
    expect(storageModule.loadBots()).not.toBe(bots);
  });

  it("returns DEFAULT_BOTS when no bot config stored", () => {
    expect(storageModule.loadBots().length).toBeGreaterThan(0);
    expect(storageModule.loadBots()[0].id).toBe("openclaw");
  });

  it("saves and loads workflows", () => {
    const wf = { w1: { id: "w1", status: "in_progress" } };
    storageModule.saveWorkflows(wf);
    expect(storageModule.loadWorkflows()).toEqual(wf);
  });

  it("saves and loads tool log", () => {
    storageModule.saveToolLog([{ id: "t1" }]);
    expect(storageModule.loadToolLog()).toEqual([{ id: "t1" }]);
  });

  it("saves and loads mode", () => {
    expect(storageModule.loadMode()).toBe("basic");
    storageModule.saveMode("dev");
    expect(storageModule.loadMode()).toBe("dev");
  });

  it("saves and loads teams and schedules", () => {
    storageModule.saveTeams([{ id: "team1" }]);
    expect(storageModule.loadTeams()).toEqual([{ id: "team1" }]);
    storageModule.saveSchedules([{ id: "s1" }]);
    expect(storageModule.loadSchedules()).toEqual([{ id: "s1" }]);
  });

  it("clears all storage", () => {
    storageModule.saveMode("dev");
    storageModule.saveBots([{ id: "b1" }]);
    storageModule.clearAllStorage();
    expect(store.size).toBe(0);
  });
});

describe("pruneHistory", () => {
  it("caps messages per bot at MAX_MESSAGES_PER_BOT keeping newest", () => {
    const many = Array.from({ length: 10050 }, (_, i) => ({ id: String(i) }));
    const pruned = storageModule.pruneHistory({ bot: many });
    expect(pruned.bot.length).toBe(storageModule.MAX_MESSAGES_PER_BOT);
    expect(pruned.bot[0].id).toBe("50");
  });

  it("normalises non-array values to empty lists", () => {
    const pruned = storageModule.pruneHistory({ bot: "junk" });
    expect(pruned.bot).toEqual([]);
  });
});

describe("pruneWorkflows", () => {
  it("keeps workflows under the cap unchanged", () => {
    const wf = { a: { id: "a", status: "completed" } };
    expect(storageModule.pruneWorkflows(wf)).toEqual(wf);
  });

  it("evicts completed workflows before in-progress ones", () => {
    const workflows = {};
    for (let i = 0; i < 120; i++) {
      workflows[`c${i}`] = { id: `c${i}`, status: "completed", startTime: i };
    }
    workflows.active = { id: "active", status: "in_progress", startTime: 0 };
    const pruned = storageModule.pruneWorkflows(workflows);
    const ids = Object.keys(pruned);
    expect(ids.length).toBe(100);
    expect(pruned.active).toBeDefined();
    expect(ids.includes("c0")).toBe(false); // oldest completed evicted first
  });
});

describe("normaliseAgentRegistry", () => {
  it("keeps only storage fields", () => {
    const registry = {
      a: { id: "a", name: "Agent", capabilities: ["x"], status: "online", lastHeartbeat: 5, secret: "drop" },
    };
    const out = storageModule.normaliseAgentRegistry(registry);
    expect(out.a).toEqual({ id: "a", name: "Agent", capabilities: ["x"], status: "online", lastHeartbeat: 5 });
    expect(out.a.secret).toBeUndefined();
  });

  it("caps at MAX_STORED_AGENTS keeping newest heartbeat", () => {
    const registry = {};
    for (let i = 0; i < 250; i++) {
      registry[`a${i}`] = { id: `a${i}`, lastHeartbeat: i };
    }
    const out = storageModule.normaliseAgentRegistry(registry);
    expect(Object.keys(out).length).toBe(200);
    expect(out.a249).toBeDefined();
    expect(out.a0).toBeUndefined();
  });
});

describe("searchMessages", () => {
  it("finds matching messages across chats with case-insensitive substring", () => {
    const history = {
      botA: [{ id: "1", role: "user", text: "Hello World" }],
      botB: [{ id: "2", role: "bot", text: "hello there" }],
    };
    const results = storageModule.searchMessages(history, "hello");
    expect(results).toHaveLength(2);
    expect(results.every((r) => typeof r.botId === "string")).toBe(true);
    expect(results.every((r) => r.message && typeof r.message.text === "string")).toBe(true);
  });

  it("returns [] for empty or whitespace query", () => {
    const history = { botA: [{ id: "1", role: "user", text: "hello" }] };
    expect(storageModule.searchMessages(history, "")).toEqual([]);
    expect(storageModule.searchMessages(history, "   ")).toEqual([]);
  });

  it("caps results at 50", () => {
    const history = {
      botA: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: "user",
        text: `match ${i}`,
      })),
    };
    const results = storageModule.searchMessages(history, "match");
    expect(results).toHaveLength(50);
  });
});
