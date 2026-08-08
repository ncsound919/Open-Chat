import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalSkillLibrary } from "./localSkillLibrary.js";

function makeStore() {
  const map = new Map();
  return {
    get: vi.fn(async (k) => (map.has(k) ? JSON.parse(map.get(k)) : null)),
    set: vi.fn(async (k, v) => map.set(k, JSON.stringify(v))),
    keys: vi.fn(async () => [...map.keys()]),
  };
}

describe("LocalSkillLibrary", () => {
  let lib, store;
  beforeEach(() => {
    store = makeStore();
    lib = new LocalSkillLibrary(store);
  });

  it("caches a pack by name:version and returns latest if version matches", async () => {
    const pack = { name: "social_post", version: "1.0.0", instructions: "post" };
    await lib.cache("social_post", "1.0.0", pack);
    const latest = { name: "social_post", version: "1.0.0" };
    const hit = await lib.get("social_post", "1.0.0");
    expect(hit.instructions).toBe("post");
    const fresh = await lib.isCurrent("social_post", latest);
    expect(fresh).toBe(true);
  });

  it("stamps cachedAt when caching a pack", async () => {
    const pack = { name: "social_post", version: "1.0.0" };
    await lib.cache("social_post", "1.0.0", pack);
    const hit = await lib.get("social_post", "1.0.0");
    expect(hit.cachedAt).toBeTypeOf("string");
    expect(new Date(hit.cachedAt).toString()).not.toBe("Invalid Date");
  });

  it("throws when the pack version does not match the cache key version", async () => {
    await expect(
      lib.cache("social_post", "1.0.0", { name: "social_post", version: "2.0.0" })
    ).rejects.toThrow(/version "2\.0\.0" does not match requested version "1\.0\.0"/);
    expect(await lib.get("social_post", "1.0.0")).toBeNull();
  });

  it("says not current when versions differ", async () => {
    await lib.cache("social_post", "1.0.0", { name: "social_post", version: "1.0.0" });
    const latest = { name: "social_post", version: "2.0.0" };
    expect(await lib.isCurrent("social_post", latest)).toBe(false);
  });

  it("says not current when there is no latest pack", async () => {
    await lib.cache("social_post", "1.0.0", { name: "social_post", version: "1.0.0" });
    expect(await lib.isCurrent("social_post", null)).toBe(false);
    expect(await lib.isCurrent("social_post", undefined)).toBe(false);
  });

  it("says not current when the latest pack has no version", async () => {
    expect(await lib.isCurrent("social_post", { name: "social_post" })).toBe(false);
  });

  it("says not current when the pack is not cached", async () => {
    const latest = { name: "social_post", version: "9.9.9" };
    expect(await lib.isCurrent("social_post", latest)).toBe(false);
  });

  it("stores local phone-native skills separately", async () => {
    await lib.putLocal("open_app", { name: "open_app", version: "0.0.1" });
    expect(await lib.getLocal("open_app")).not.toBeNull();
  });

  it("returns null for missing pack", async () => {
    expect(await lib.get("nope", "1.0.0")).toBeNull();
  });

  it("listCached returns cached pack keys with the prefix stripped", async () => {
    await lib.cache("social_post", "1.0.0", { name: "social_post", version: "1.0.0" });
    await lib.cache("pricing", "2.0.0", { name: "pricing", version: "2.0.0" });
    const cached = await lib.listCached();
    expect(cached).toContain("social_post:1.0.0");
    expect(cached).toContain("pricing:2.0.0");
  });

  it("listCached does not include local phone-native skills", async () => {
    await lib.cache("social_post", "1.0.0", { name: "social_post", version: "1.0.0" });
    await lib.putLocal("open_app", { name: "open_app", version: "0.0.1" });
    const cached = await lib.listCached();
    expect(cached).toEqual(["social_post:1.0.0"]);
  });

  it("listCached returns [] when the store has no keys method", async () => {
    const noKeysStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    };
    const noKeysLib = new LocalSkillLibrary(noKeysStore);
    expect(await noKeysLib.listCached()).toEqual([]);
  });
});
