import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalSkillLibrary } from "./localSkillLibrary.js";

function makeStore() {
  const map = new Map();
  return {
    get: vi.fn(async (k) => (map.has(k) ? JSON.parse(map.get(k)) : null)),
    set: vi.fn(async (k, v) => map.set(k, JSON.stringify(v))),
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
    await lib.cache("social_post:1.0.0", pack);
    const latest = { name: "social_post", version: "1.0.0" };
    const hit = await lib.get("social_post", "1.0.0");
    expect(hit.instructions).toBe("post");
    const fresh = await lib.isCurrent("social_post", "1.0.0", latest);
    expect(fresh).toBe(true);
  });

  it("says not current when versions differ", async () => {
    await lib.cache("social_post:1.0.0", { name: "social_post", version: "1.0.0" });
    const latest = { name: "social_post", version: "2.0.0" };
    expect(await lib.isCurrent("social_post", "2.0.0", latest)).toBe(false);
  });

  it("stores local phone-native skills separately", async () => {
    await lib.putLocal("open_app", { name: "open_app", version: "0.0.1" });
    expect(await lib.getLocal("open_app")).not.toBeNull();
  });

  it("returns null for missing pack", async () => {
    expect(await lib.get("nope", "1.0.0")).toBeNull();
  });
});
