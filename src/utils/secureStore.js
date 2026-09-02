/**
 * secureStore — at-rest encryption for Open Chat's sensitive local data.
 *
 * Chat history and bot config (which holds access tokens) are encrypted with
 * AES-256-GCM before being written to Preferences/localStorage. The key is
 * derived from the user's passphrase via PBKDF2-SHA256 (120k iterations) with
 * a random salt, so the encrypted blob is only readable after a correct
 * unlock. Nothing in the app bundle can decrypt it.
 *
 * Layout (all values base64):
 *   openchat_sec__meta        → { v:1, salt }            (shared salt)
 *   openchat_sec_<origKey>    → { v:1, iv, data }        (ciphertext)
 *
 * storage.js delegates reads/writes for the sensitive keys here. Reads are
 * served from a decrypted in-memory cache; writes encrypt fire-and-forget
 * (mirroring the existing native-storage pattern).
 */

import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform.js";

const META_KEY = "openchat_sec__meta";
const PREFIX = "openchat_sec_";
const KDF_ITERATIONS = 120_000;
const FORMAT = "AES-GCM";
const SUPPORTED = typeof crypto !== "undefined" && !!crypto.subtle;

let _configuredKeys = [];
let _ready = false;
let _key = null;
let _cache = {}; // decrypted values by original key
let _blobs = {}; // raw blob strings by blob key (preloaded at boot)

// ── raw platform storage (same split as storage.js) ─────────────────────────
function rawGet(key) {
  if (isNative) return _blobs[key] ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key, value) {
  _blobs[key] = value;
  if (isNative) {
    Preferences.set({ key, value }).catch((err) =>
      console.error(`[OpenChat] secureStore set ${key} failed:`, err)
    );
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.error(`[OpenChat] secureStore set ${key} failed:`, err);
  }
}

function rawRemove(key) {
  delete _blobs[key];
  if (isNative) {
    Preferences.remove({ key }).catch(() => {});
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // non-fatal
  }
}

/**
 * Async variant of rawSet that REJECTS when native persistence fails, so
 * durable callers (enable/change) can verify a blob landed before deleting
 * the plaintext copy. Web localStorage either writes or throws synchronously.
 */
async function rawSetAsync(key, value) {
  _blobs[key] = value;
  if (isNative) {
    await Preferences.set({ key, value });
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    throw err;
  }
}

/** Async read of a raw storage value (used for legacy plaintext on native). */
async function readRaw(key) {
  if (!isNative) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    const { value } = await Preferences.get({ key });
    return value;
  } catch {
    return null;
  }
}

// ── base64 helpers ───────────────────────────────────────────────────────────
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function blobKeyFor(origKey) {
  return PREFIX + origKey;
}

async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: FORMAT, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptValue(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: FORMAT, iv },
    key,
    new TextEncoder().encode(value)
  );
  return { v: 1, iv: bufToB64(iv), data: bufToB64(data) };
}

async function decryptBlob(key, blob) {
  const { iv, data } = blob;
  const plain = await crypto.subtle.decrypt(
    { name: FORMAT, iv: b64ToBytes(iv) },
    key,
    b64ToBytes(data)
  );
  return new TextDecoder().decode(plain);
}

// ── public API ───────────────────────────────────────────────────────────────

/** Register which original keys are encrypted. Called once by storage.js. */
export function configure({ keys = [] } = {}) {
  _configuredKeys = keys;
}

export function isSupported() {
  return SUPPORTED;
}

/** True when a passphrase has been set and encrypted blobs exist. */
export function isEnabled() {
  return _configuredKeys.some((k) => rawGet(blobKeyFor(k)) !== null) || !!rawGet(META_KEY);
}

/** True when the store is unlocked and decryptable in memory. */
export function isUnlocked() {
  return _ready;
}

/**
 * Preload raw encrypted blobs into memory. Must be awaited at boot before the
 * app can decide whether to show the lock screen.
 */
export async function initSecureStore() {
  if (!SUPPORTED) return;
  _blobs = {};
  if (!isNative) {
    // localStorage is synchronous — enumerate known blob keys directly.
    return;
  }
  const blobKeys = [META_KEY, ..._configuredKeys.map(blobKeyFor)];
  await Promise.all(
    blobKeys.map(async (key) => {
      try {
        const { value } = await Preferences.get({ key });
        if (value !== null) _blobs[key] = value;
      } catch {
        // non-fatal
      }
    })
  );
}

/** Unlock the store with the user's passphrase. Throws on a wrong passphrase. */
export async function unlock(passphrase) {
  if (!SUPPORTED) throw new Error("Secure storage is not available in this context");
  if (!isEnabled()) return { enabled: false };

  const metaRaw = rawGet(META_KEY);
  if (!metaRaw) return { enabled: false };
  const meta = JSON.parse(metaRaw);
  const key = await deriveKey(passphrase, b64ToBytes(meta.salt));

  const cache = {};
  for (const origKey of _configuredKeys) {
    const blobRaw = rawGet(blobKeyFor(origKey));
    if (blobRaw === null) continue;
    cache[origKey] = await decryptBlob(key, JSON.parse(blobRaw)); // throws on wrong passphrase
  }

  _key = key;
  _cache = cache;
  _ready = true;
  return { enabled: true };
}

/**
 * Enable encryption: read the current plaintext values for the sensitive keys,
 * encrypt them under a freshly derived key, and remove the plaintext copies.
 */
export async function enable(passphrase) {
  if (!SUPPORTED) throw new Error("Secure storage is not available in this context");
  if (String(passphrase || "").length < 4) {
    throw new Error("Passphrase must be at least 4 characters");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);

  const cache = {};
  for (const origKey of _configuredKeys) {
    const legacyRaw = await readRaw(origKey);
    const value = legacyRaw !== null ? legacyRaw : "";
    cache[origKey] = value;
    const blob = await encryptValue(key, value);
    // Persist the blob BEFORE deleting the plaintext: a failed native write
    // must not leave us with neither copy. META is written last so a partial
    // failure leaves the store still-plaintext.
    await rawSetAsync(blobKeyFor(origKey), JSON.stringify(blob));
    rawRemove(origKey); // delete the plaintext copy
  }
  await rawSetAsync(META_KEY, JSON.stringify({ v: 1, salt: bufToB64(salt) }));

  _key = key;
  _cache = cache;
  _ready = true;
  return { enabled: true };
}

/** Synchronous read of a decrypted value (null when locked). */
export function get(origKey) {
  if (!_ready) return null;
  return _cache[origKey] ?? null;
}

/** Encrypt and persist a value. Fire-and-forget write like native storage. */
export function set(origKey, value) {
  if (!_ready) return;
  if (value === null || value === undefined) {
    delete _cache[origKey];
    rawRemove(blobKeyFor(origKey));
    return;
  }
  _cache[origKey] = value;
  const snapshot = value;
  (async () => {
    try {
      const blob = await encryptValue(_key, snapshot);
      rawSet(blobKeyFor(origKey), JSON.stringify(blob));
    } catch (err) {
      console.error(`[OpenChat] secureStore encrypt ${origKey} failed:`, err);
    }
  })();
}

/** Re-encrypt the whole store with a new passphrase (store must be unlocked). */
export async function change(passphrase, newPassphrase) {
  if (!_ready) throw new Error("Store is locked");
  if (String(newPassphrase || "").length < 4) {
    throw new Error("New passphrase must be at least 4 characters");
  }
  const oldKey = _key;
  const oldMetaRaw = rawGet(META_KEY);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(newPassphrase, salt);
  try {
    // Persist every blob under the new key before committing the new META, so
    // a failed write can't leave a half-re-keyed store behind.
    for (const [origKey, value] of Object.entries(_cache)) {
      const blob = await encryptValue(key, value);
      await rawSetAsync(blobKeyFor(origKey), JSON.stringify(blob));
    }
    await rawSetAsync(META_KEY, JSON.stringify({ v: 1, salt: bufToB64(salt) }));
  } catch (err) {
    // Roll back blobs already written under the new key using the old key,
    // and restore the old META, so the store stays decryptable under the old
    // passphrase.
    for (const [origKey, value] of Object.entries(_cache)) {
      try {
        const blob = await encryptValue(oldKey, value);
        await rawSetAsync(blobKeyFor(origKey), JSON.stringify(blob));
      } catch {
        // keep whatever was written — nothing better we can do per-key
      }
    }
    if (oldMetaRaw !== null) rawSet(META_KEY, oldMetaRaw);
    throw err;
  }
  _key = key;
  return { changed: true };
}

/** Lock the store, discarding the decrypted cache and key. */
export function lock() {
  _ready = false;
  _key = null;
  _cache = {};
}

/** Remove all encrypted blobs (used by clearAllStorage). */
export function clearAll() {
  _ready = false;
  _key = null;
  _cache = {};
  rawRemove(META_KEY);
  for (const origKey of _configuredKeys) {
    rawRemove(blobKeyFor(origKey));
  }
}
