/**
 * LocalSkillLibrary — versioned on-device cache of Draymond skill packs plus
 * phone-native skills. Backed by a small async KV store (Capacitor Preferences
 * on device, in-memory in tests). Version-aware so the worker only uses a
 * cached pack when its version matches Draymond's latest.
 */

const PACK_PREFIX = "skill_pack:";
const LOCAL_PREFIX = "skill_local:";

export class LocalSkillLibrary {
  constructor(store) {
    this.store = store;
  }

  async cache(key, pack) {
    await this.store.set(PACK_PREFIX + key, { ...pack, cachedAt: new Date().toISOString() });
  }

  async get(name, version) {
    const entry = await this.store.get(PACK_PREFIX + `${name}:${version}`);
    return entry ?? null;
  }

  async isCurrent(name, version, latestPack) {
    if (!latestPack) return false;
    const cached = await this.get(name, latestPack.version ?? version);
    return !!cached && cached.version === latestPack.version;
  }

  async putLocal(name, pack) {
    await this.store.set(LOCAL_PREFIX + name, pack);
  }

  async getLocal(name) {
    return (await this.store.get(LOCAL_PREFIX + name)) ?? null;
  }

  async listCached() {
    // Store impls may not support listing; try store.keys() when present.
    if (typeof this.store.keys === "function") {
      const keys = await this.store.keys();
      return keys.filter((k) => k.startsWith(PACK_PREFIX)).map((k) => k.slice(PACK_PREFIX.length));
    }
    return [];
  }
}
