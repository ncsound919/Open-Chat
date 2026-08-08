/**
 * LocalSkillLibrary — versioned on-device cache of Draymond skill packs plus
 * phone-native skills. Backed by a small async KV store (Capacitor Preferences
 * on device, in-memory in tests). Version-aware so the worker only uses a
 * cached pack when its version matches Draymond's latest.
 *
 * Store interface:
 *   store.get(key)              → Promise<object|null>
 *   store.set(key, value)       → Promise
 *   store.keys()                → Promise<string[]> (optional; used by listCached)
 *
 * The store is responsible for JSON serialization of values.
 *
 * Key formats (constructed internally, never exposed to callers):
 *   skill_pack:<name>:<version>
 *   skill_local:<name>
 */

const PACK_PREFIX = "skill_pack:";
const LOCAL_PREFIX = "skill_local:";

export class LocalSkillLibrary {
  constructor(store) {
    this.store = store;
  }

  _key(name, version) {
    return PACK_PREFIX + `${name}:${version}`;
  }

  /**
   * Stores a Draymond skill pack under skill_pack:<name>:<version>.
   * Defensively rejects a pack whose version does not match the key, since
   * version drift would make isCurrent() return false forever (perpetual refetch).
   */
  async cache(name, version, pack) {
    if (pack.version !== version) {
      throw new Error(
        `LocalSkillLibrary.cache: pack version "${pack.version}" does not match requested version "${version}" for "${name}"`
      );
    }
    await this.store.set(this._key(name, version), { ...pack, cachedAt: new Date().toISOString() });
  }

  async get(name, version) {
    const entry = await this.store.get(this._key(name, version));
    return entry ?? null;
  }

  /**
   * True when a cached pack exists whose version equals latestPack.version.
   * latestPack.version is authoritative — it is used as the lookup version,
   * so callers should not pass a version separately.
   */
  async isCurrent(name, latestPack) {
    if (!latestPack || !latestPack.version) return false;
    const cached = await this.get(name, latestPack.version);
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
      if (!Array.isArray(keys)) return [];
      return keys.filter((k) => k.startsWith(PACK_PREFIX)).map((k) => k.slice(PACK_PREFIX.length));
    }
    return [];
  }
}
