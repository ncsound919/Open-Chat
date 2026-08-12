import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// secureStore uses localStorage on web (isNative false in jsdom) — provide a
// stub. Module state is singleton, so re-import fresh per test.
const store = new Map();

const prefsMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: prefsMock.get, set: prefsMock.set, remove: prefsMock.remove },
}));

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

const supported = typeof crypto !== "undefined" && !!crypto.subtle;

let sec;

beforeEach(async () => {
  store.clear();
  global.localStorage = makeLocalStorage();
  prefsMock.get.mockReset();
  prefsMock.set.mockReset();
  prefsMock.remove.mockReset();
  vi.resetModules();
  sec = await import("./secureStore.js");
  sec.configure({ keys: ["openchat_hist_v1", "openchat_conf_v1"] });
});

afterEach(() => {
  delete global.localStorage;
  vi.restoreAllMocks();
});

describe("secureStore", () => {
  it("reports support based on WebCrypto availability", () => {
    expect(sec.isSupported()).toBe(supported);
  });

  it("is disabled and locked before any passphrase is set", () => {
    expect(sec.isEnabled()).toBe(false);
    expect(sec.isUnlocked()).toBe(false);
    expect(sec.get("openchat_hist_v1")).toBeNull();
  });

  it("enables: encrypts blobs, removes plaintext, and serves decrypted reads", async () => {
    // Seed legacy plaintext values.
    global.localStorage.setItem("openchat_hist_v1", JSON.stringify({ bot: [{ text: "hi" }] }));
    global.localStorage.setItem("openchat_conf_v1", JSON.stringify([{ id: "b", token: "sekret" }]));

    await sec.enable("hunter2");

    expect(sec.isEnabled()).toBe(true);
    expect(sec.isUnlocked()).toBe(true);
    expect(sec.get("openchat_hist_v1")).toBe(JSON.stringify({ bot: [{ text: "hi" }] }));
    expect(sec.get("openchat_conf_v1")).toContain("sekret");

    // Plaintext copies must be gone.
    expect(global.localStorage.getItem("openchat_hist_v1")).toBeNull();
    expect(global.localStorage.getItem("openchat_conf_v1")).toBeNull();

    // Blobs are present and not human-readable.
    const blob = global.localStorage.getItem("openchat_sec_openchat_conf_v1");
    expect(blob).toBeTruthy();
    expect(blob).not.toContain("sekret");
  });

  it("round-trips after lock + unlock with the right passphrase", async () => {
    global.localStorage.setItem("openchat_hist_v1", "secret-history");
    await sec.enable("hunter2");
    sec.lock();

    expect(sec.isUnlocked()).toBe(false);
    expect(sec.get("openchat_hist_v1")).toBeNull();

    const res = await sec.unlock("hunter2");
    expect(res.enabled).toBe(true);
    expect(sec.isUnlocked()).toBe(true);
    expect(sec.get("openchat_hist_v1")).toBe("secret-history");
  });

  it("rejects a wrong passphrase on unlock", async () => {
    global.localStorage.setItem("openchat_hist_v1", "x");
    await sec.enable("hunter2");
    sec.lock();

    await expect(sec.unlock("wrong")).rejects.toThrow();
    expect(sec.isUnlocked()).toBe(false);
  });

  it("set() encrypts and persists new values while unlocked", async () => {
    await sec.enable("hunter2");
    sec.set("openchat_conf_v1", JSON.stringify([{ id: "a", token: "sekret-token-abc123" }]));

    await vi.waitFor(() => {
      expect(global.localStorage.getItem("openchat_sec_openchat_conf_v1")).toBeTruthy();
    });
    const blob = global.localStorage.getItem("openchat_sec_openchat_conf_v1");
    expect(blob).not.toContain("sekret");

    // Lock + unlock must recover the newly written value.
    sec.lock();
    await sec.unlock("hunter2");
    expect(sec.get("openchat_conf_v1")).toBe(JSON.stringify([{ id: "a", token: "sekret-token-abc123" }]));
  });

  it("change() re-encrypts under a new passphrase", async () => {
    global.localStorage.setItem("openchat_hist_v1", "payload");
    await sec.enable("oldpass");

    await sec.change("oldpass", "newpass");
    sec.lock();

    await expect(sec.unlock("oldpass")).rejects.toThrow();
    const res = await sec.unlock("newpass");
    expect(res.enabled).toBe(true);
    expect(sec.get("openchat_hist_v1")).toBe("payload");
  });

  it("clearAll removes blobs and resets state", async () => {
    global.localStorage.setItem("openchat_hist_v1", "payload");
    await sec.enable("hunter2");

    sec.clearAll();
    expect(sec.isEnabled()).toBe(false);
    expect(sec.isUnlocked()).toBe(false);
    expect(global.localStorage.getItem("openchat_sec_openchat_hist_v1")).toBeNull();
  });

  it("enable rejects short passphrases", async () => {
    await expect(sec.enable("abc")).rejects.toThrow(/at least 4/);
    expect(sec.isEnabled()).toBe(false);
  });

  it("unlock returns { enabled:false } when no encryption is configured", async () => {
    const res = await sec.unlock("whatever");
    expect(res.enabled).toBe(false);
  });
});

describe("native (Capacitor) branch", () => {
  beforeEach(async () => {
    store.clear();
    global.localStorage = makeLocalStorage();
    prefsMock.get.mockReset();
    prefsMock.set.mockReset();
    prefsMock.remove.mockReset();
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
    sec = await import("./secureStore.js");
    sec.configure({ keys: ["openchat_hist_v1", "openchat_conf_v1"] });
  });

  afterEach(() => {
    vi.doUnmock("./platform.js");
  });

  it("enable() encrypts the legacy plaintext read from Preferences and removes it", async () => {
    prefsMock.get.mockImplementation(async ({ key }) =>
      key === "openchat_hist_v1" ? { value: "legacy-history" } : { value: null }
    );
    prefsMock.set.mockResolvedValue(undefined);
    prefsMock.remove.mockResolvedValue(undefined);

    await sec.enable("hunter2");

    expect(sec.isEnabled()).toBe(true);
    expect(sec.get("openchat_hist_v1")).toBe("legacy-history");
    // Legacy plaintext key removed, encrypted blob written.
    expect(prefsMock.remove).toHaveBeenCalledWith(
      expect.objectContaining({ key: "openchat_hist_v1" })
    );
    expect(prefsMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ key: "openchat_sec_openchat_hist_v1" })
    );
    const blobSet = prefsMock.set.mock.calls.find(
      (c) => c[0].key === "openchat_sec_openchat_hist_v1"
    );
    expect(blobSet[0].value).not.toContain("legacy-history");
  });

  it("initSecureStore preloads blobs so unlock works on native", async () => {
    // Simulate an already-enabled store: meta + one data blob in Preferences.
    const payload = JSON.stringify({ v: 1, salt: "c2FsdA==", iv: "aXY=", data: "ZGF0YQ==" });
    prefsMock.get.mockImplementation(async ({ key }) =>
      key === "openchat_sec__meta"
        ? { value: JSON.stringify({ v: 1, salt: "c2FsdA==" }) }
        : key === "openchat_sec_openchat_hist_v1"
        ? { value: payload }
        : { value: null }
    );

    await sec.initSecureStore();
    expect(sec.isEnabled()).toBe(true);
  });
});
