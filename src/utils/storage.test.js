import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Native (Capacitor) branch support: storage.js imports Preferences from
// @capacitor/preferences and isNative from ./platform.js. In jsdom isNative
// is false, so storage.js uses localStorage. The native branches are tested by
// mocking platform.js (via vi.doMock) and Preferences (below). We use a static
// ESM import (await import) instead of require() because require() corrupts
// v8 line/statement attribution for this module (verified empirically).
const prefsMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: prefsMock.get,
    set: prefsMock.set,
    remove: prefsMock.remove,
  },
}));

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

beforeEach(async () => {
  store.clear();
  global.localStorage = makeLocalStorage();
  vi.resetModules();
  storageModule = await import("./storage.js");
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

describe("storage corrupted-data and error paths", () => {
  beforeEach(async () => {
    store.clear();
    global.localStorage = makeLocalStorage();
    vi.resetModules();
    storageModule = await import("./storage.js");
  });

  function corrupt(key) {
    global.localStorage.setItem(key, "not-json{{");
  }

  it("loadToolLog resets on corrupted or non-array data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    corrupt("openchat_toollog_v1");
    expect(storageModule.loadToolLog()).toEqual([]);
    expect(warn).toHaveBeenCalled();

    global.localStorage.setItem("openchat_toollog_v1", JSON.stringify({ not: "array" }));
    expect(storageModule.loadToolLog()).toEqual([]);
    warn.mockRestore();
  });

  it("saveToolLog stores an empty list for non-array input and swallows storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    storageModule.saveToolLog("nope");
    expect(store.get("openchat_toollog_v1")).toBe("[]");

    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveToolLog([{ id: 1 }]);
    expect(err).toHaveBeenCalled();
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("loadMode handles dev, non-dev, and corrupted values", () => {
    storageModule.saveMode("dev");
    expect(storageModule.loadMode()).toBe("dev");
    storageModule.saveMode("something-else");
    expect(storageModule.loadMode()).toBe("basic");
    corrupt("openchat_mode_v1");
    expect(storageModule.loadMode()).toBe("basic");
  });

  it("saveMode swallows storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveMode("dev");
    expect(err).toHaveBeenCalled();
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("loadTeams and loadSchedules reset on corrupted JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    corrupt("openchat_teams_v1");
    corrupt("openchat_schedules_v1");
    expect(storageModule.loadTeams()).toEqual([]);
    expect(storageModule.loadSchedules()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("saveTeams and saveSchedules swallow storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveTeams([{ id: 1 }]);
    storageModule.saveSchedules([{ id: 1 }]);
    expect(err).toHaveBeenCalledTimes(2);
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("clearAllStorage swallows storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.removeItem;
    global.localStorage.removeItem = vi.fn(() => {
      throw new Error("nope");
    });
    storageModule.clearAllStorage();
    expect(err).toHaveBeenCalled();
    global.localStorage.removeItem = original;
    err.mockRestore();
  });
});

describe("additional web branch coverage", () => {
  it("loadHist resets when the stored value is JSON null", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.localStorage.setItem("openchat_hist_v1", "null");
    expect(storageModule.loadHist()).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("saveHist swallows storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveHist({ bot: [{ id: "1" }] });
    expect(err).toHaveBeenCalled();
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("loadBots resets on invalid JSON, non-array data, and empty arrays", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.localStorage.setItem("openchat_conf_v1", "{bad json");
    expect(storageModule.loadBots()).toEqual(storageModule.DEFAULT_BOTS);
    global.localStorage.setItem("openchat_conf_v1", JSON.stringify({ not: "array" }));
    expect(storageModule.loadBots()).toEqual(storageModule.DEFAULT_BOTS);
    global.localStorage.setItem("openchat_conf_v1", JSON.stringify([]));
    expect(storageModule.loadBots()).toEqual(storageModule.DEFAULT_BOTS);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("saveBots swallows storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveBots([{ id: 1 }]);
    expect(err).toHaveBeenCalled();
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("loadWorkflows resets on arrays, JSON null, and invalid JSON", () => {
    expect(storageModule.loadWorkflows()).toEqual({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.localStorage.setItem("openchat_workflows_v1", JSON.stringify([1, 2]));
    expect(storageModule.loadWorkflows()).toEqual({});
    global.localStorage.setItem("openchat_workflows_v1", "null");
    expect(storageModule.loadWorkflows()).toEqual({});
    global.localStorage.setItem("openchat_workflows_v1", "{bad json");
    expect(storageModule.loadWorkflows()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("saveWorkflows prunes to the cap and swallows storage errors", () => {
    const many = {};
    for (let i = 0; i < 120; i++) {
      many[`w${i}`] = { id: `w${i}`, status: "completed", startTime: i };
    }
    storageModule.saveWorkflows(many);
    expect(Object.keys(storageModule.loadWorkflows()).length).toBe(100);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveWorkflows({ a: { id: "a", status: "in_progress" } });
    expect(err).toHaveBeenCalled();
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("pruneWorkflows sorts with missing status and startTime fields", () => {
    const workflows = {};
    for (let i = 0; i < 105; i++) {
      workflows[`w${i}`] = { id: `w${i}`, startTime: i };
    }
    workflows["noworkflow"] = { id: "noworkflow" };
    const pruned = storageModule.pruneWorkflows(workflows);
    expect(Object.keys(pruned).length).toBe(100);
    expect(pruned.noworkflow).toBeUndefined();
    expect(pruned.w104).toBeDefined();
  });

  it("loadAgentRegistry round-trips and resets on corruption", () => {
    expect(storageModule.loadAgentRegistry()).toEqual({});
    const reg = { a1: { id: "a1", name: "A", capabilities: ["x"], status: "online", lastHeartbeat: 1 } };
    storageModule.saveAgentRegistry(reg);
    expect(storageModule.loadAgentRegistry()).toEqual(reg);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.localStorage.setItem("openchat_agents_v1", JSON.stringify([1]));
    expect(storageModule.loadAgentRegistry()).toEqual({});
    global.localStorage.setItem("openchat_agents_v1", "null");
    expect(storageModule.loadAgentRegistry()).toEqual({});
    global.localStorage.setItem("openchat_agents_v1", "{bad json");
    expect(storageModule.loadAgentRegistry()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("saveAgentRegistry swallows storage errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = global.localStorage.setItem;
    global.localStorage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    storageModule.saveAgentRegistry({ a1: { id: "a1", name: "A" } });
    expect(err).toHaveBeenCalled();
    global.localStorage.setItem = original;
    err.mockRestore();
  });

  it("normaliseAgentRegistry skips agents without an id and missing fields", () => {
    const out = storageModule.normaliseAgentRegistry({
      x: { name: "no id", capabilities: ["a"], status: "online", lastHeartbeat: 5 },
      y: { id: "y", name: "Y" },
    });
    expect(out.x).toBeUndefined();
    expect(out.y).toEqual({ id: "y", name: "Y" });
  });

  it("loadToolLog caps at 1000 entries and handles empty storage", () => {
    expect(storageModule.loadToolLog()).toEqual([]);
    const many = Array.from({ length: 1500 }, (_, i) => ({ id: String(i) }));
    storageModule.saveToolLog(many);
    const loaded = storageModule.loadToolLog();
    expect(loaded.length).toBe(1000);
    expect(loaded[0].id).toBe("500");
  });

  it("loadTeams and loadSchedules reset on non-array data and handle empty storage", () => {
    expect(storageModule.loadTeams()).toEqual([]);
    expect(storageModule.loadSchedules()).toEqual([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.localStorage.setItem("openchat_teams_v1", JSON.stringify({ not: "array" }));
    global.localStorage.setItem("openchat_schedules_v1", JSON.stringify({ not: "array" }));
    expect(storageModule.loadTeams()).toEqual([]);
    expect(storageModule.loadSchedules()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("checkStorageQuota warns when usage approaches browser limits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storageModule.saveMode("dev");
    const big = { bot: [{ id: "1", text: "x".repeat(4.2 * 1024 * 1024) }] };
    storageModule.saveHist(big);
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.map((c) => c[0]).join(" ");
    expect(msg).toContain("Consider clearing old chat history.");
    warn.mockRestore();
  });

  it("checkStorageQuota silently tolerates storageKeys errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const origLength = Object.getOwnPropertyDescriptor(global.localStorage, "length");
    Object.defineProperty(global.localStorage, "length", {
      get: () => {
        throw new Error("boom");
      },
    });
    expect(() => storageModule.saveHist({ bot: [{ id: "1" }] })).not.toThrow();
    Object.defineProperty(global.localStorage, "length", origLength);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("searchMessages handles missing history, missing messages, and missing text", () => {
    expect(storageModule.searchMessages(undefined, "x")).toEqual([]);
    expect(storageModule.searchMessages({ bot: null }, "x")).toEqual([]);
    expect(storageModule.searchMessages({ bot: [{ id: "1", time: 5 }] }, "x")).toEqual([]);
    const r = storageModule.searchMessages({ bot: [{ id: "1", text: "hello world", time: 3 }] }, "WORLD");
    expect(r).toHaveLength(1);
    expect(r[0].time).toBe(3);
  });

  it("initNativeStorage is a no-op on the web", async () => {
    await expect(storageModule.initNativeStorage()).resolves.toBeUndefined();
  });

  it("checkStorageQuota handles falsy stored values", () => {
    global.localStorage.setItem("openchat_mode_v1", "");
    storageModule.saveHist({ bot: [{ id: "1", text: "hi" }] });
    expect(store.get("openchat_hist_v1")).toBeTruthy();
  });

  it("pruneWorkflows sorts many in-progress workflows by startTime", () => {
    const workflows = {};
    for (let i = 0; i < 105; i++) {
      workflows[`w${i}`] = { id: `w${i}`, status: "in_progress", startTime: i };
    }
    const pruned = storageModule.pruneWorkflows(workflows);
    expect(Object.keys(pruned).length).toBe(100);
    expect(pruned.w104).toBeDefined();
  });

  it("loadMode swallows storageGet errors", () => {
    const original = global.localStorage.getItem;
    global.localStorage.getItem = vi.fn(() => {
      throw new Error("nope");
    });
    expect(storageModule.loadMode()).toBe("basic");
    global.localStorage.getItem = original;
  });
});

describe("native (Capacitor) branches", () => {
  beforeEach(async () => {
    vi.doMock("./platform.js", () => ({
      isNative: true,
      platform: "android",
      isAndroid: true,
      isIOS: false,
      isElectron: false,
      isWeb: false,
      getPlatformLabel: () => "Android",
    }));
    vi.resetModules();
    storageModule = await import("./storage.js");
  });

  afterEach(() => {
    vi.doUnmock("./platform.js");
  });

  it("initNativeStorage populates the in-memory cache", async () => {
    prefsMock.get.mockImplementation(async ({ key }) =>
      key === "openchat_mode_v1" ? { value: "dev" } : { value: null }
    );
    await storageModule.initNativeStorage();
    expect(prefsMock.get).toHaveBeenCalled();
    expect(storageModule.loadMode()).toBe("dev");
  });

  it("storageSet persists via Preferences and swallows write failures", async () => {
    prefsMock.set.mockResolvedValue(undefined);
    storageModule.saveMode("dev");
    await vi.waitFor(() => expect(prefsMock.set).toHaveBeenCalled());
    expect(storageModule.loadMode()).toBe("dev");

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    prefsMock.set.mockRejectedValue(new Error("native write failed"));
    storageModule.saveMode("dev");
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });

  it("storageRemove clears the native cache and swallows failures", async () => {
    prefsMock.set.mockResolvedValue(undefined);
    prefsMock.remove.mockResolvedValue(undefined);
    storageModule.saveMode("dev");
    storageModule.clearAllStorage();
    await vi.waitFor(() => expect(prefsMock.remove).toHaveBeenCalled());
    expect(storageModule.loadMode()).toBe("basic");

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    prefsMock.remove.mockRejectedValue(new Error("native remove failed"));
    storageModule.clearAllStorage();
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });

  it("native checkStorageQuota warns without the web hint", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prefsMock.set.mockResolvedValue(undefined);
    const big = { bot: [{ id: "1", text: "x".repeat(4.2 * 1024 * 1024) }] };
    storageModule.saveHist(big);
    await vi.waitFor(() => expect(prefsMock.set).toHaveBeenCalled());
    const msg = warn.mock.calls.map((c) => c[0]).join(" ");
    expect(msg).toContain("Storage usage");
    expect(msg).not.toContain("Consider clearing");
    warn.mockRestore();
  });
});
