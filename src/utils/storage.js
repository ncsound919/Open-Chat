import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform.js';

// Storage keys
const HIST_KEY = "openchat_hist_v1";
const CONF_KEY = "openchat_conf_v1";
const WORKFLOWS_KEY = "openchat_workflows_v1";
const AGENTS_KEY = "openchat_agents_v1";
const TOOLLOG_KEY = "openchat_toollog_v1";
const MODE_KEY = "openchat_mode_v1";
const TEAMS_KEY = "openchat_teams_v1";
const SCHEDULES_KEY = "openchat_schedules_v1";

// ── Platform-aware storage abstraction ───────────────────────────────────────
// On native (Android/iOS), use Capacitor Preferences (SharedPreferences).
// On web/Electron, use localStorage (synchronous, same as before).
// Capacitor Preferences is async, so all "native" writes are fire-and-forget
// while reads eagerly cache into a sync in-memory map on init.

/** In-memory mirror of Capacitor Preferences (populated at init) */
const _nativeCache = {};

/**
 * Initialise the native storage cache by loading all known keys.
 * Must be awaited once before the app renders (called from main.jsx).
 * On web/Electron this is a no-op.
 */
export async function initNativeStorage() {
  if (!isNative) return;
  const keys = [
    HIST_KEY, CONF_KEY, WORKFLOWS_KEY, AGENTS_KEY, TOOLLOG_KEY,
    MODE_KEY, TEAMS_KEY, SCHEDULES_KEY,
  ];
  await Promise.all(
    keys.map(async (key) => {
      const { value } = await Preferences.get({ key });
      if (value !== null) _nativeCache[key] = value;
    })
  );
}

/** Synchronous read — returns raw string or null */
function storageGet(key) {
  if (isNative) {
    return _nativeCache[key] ?? null;
  }
  return localStorage.getItem(key);
}

/** Synchronous write — persists to native asynchronously */
function storageSet(key, value) {
  if (isNative) {
    _nativeCache[key] = value;
    // Fire-and-forget async persist
    Preferences.set({ key, value }).catch((err) =>
      console.error(`[OpenChat] Preferences.set(${key}) failed:`, err)
    );
    return;
  }
  localStorage.setItem(key, value);
}

/** Synchronous remove — persists to native asynchronously */
function storageRemove(key) {
  if (isNative) {
    delete _nativeCache[key];
    Preferences.remove({ key }).catch((err) =>
      console.error(`[OpenChat] Preferences.remove(${key}) failed:`, err)
    );
    return;
  }
  localStorage.removeItem(key);
}

/** Get all stored keys */
function storageKeys() {
  if (isNative) return Object.keys(_nativeCache);
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    keys.push(localStorage.key(i));
  }
  return keys;
}

// Safety limits
export const MAX_MESSAGES_PER_BOT = 10_000;
const STORAGE_WARN_BYTES = 4 * 1024 * 1024; // warn at 4 MB (browsers allow ~5–10 MB)

// Maximum number of workflows to persist (newest retained)
const MAX_STORED_WORKFLOWS = 100;

// Maximum number of agents to persist
const MAX_STORED_AGENTS = 200;

// Fields retained when normalising an agent record for storage
const AGENT_STORAGE_FIELDS = ["id", "name", "capabilities", "status", "lastHeartbeat"];


export const DEFAULT_BOTS = [
  {
    id: "openclaw",
    name: "OpenClaw",
    avatar: "🦞",
    color: "#34d399",
    tagline: "Personal AI · Always on",
    protocol: "openclaw",
    host: "127.0.0.1",
    port: 18789,
    token: "",
  },
  {
    id: "hermes",
    name: "Hermes",
    avatar: "☿",
    color: "#818cf8",
    tagline: "Nous Research · Self-improving",
    protocol: "hermes",
    host: "https://gw.overlay365.com",
    port: 8642,
    token: "",
    voiceEnabled: true,
    voiceBackend: "draymond",
    aetherdeskApiKey: "",
  },
  {
    id: "draymond",
    name: "Draymond",
    avatar: "🎛️",
    color: "#22d3ee",
    tagline: "Orchestrator · Multi-agent",
    protocol: "draymond",
    // Dev override (gitignored .env.local) so USB-debug builds can reach the
    // local Draymond via `adb reverse tcp:3444`; defaults to the cloud URL.
    host: import.meta.env.VITE_DRAYMOND_URL ? new URL(import.meta.env.VITE_DRAYMOND_URL).hostname : "https://draymond.overlay365.com",
    port: import.meta.env.VITE_DRAYMOND_URL ? Number(new URL(import.meta.env.VITE_DRAYMOND_URL).port) || 3444 : 3000,
    token: import.meta.env.VITE_DRAYMOND_TOKEN ?? "",
    voiceCallEnabled: true,
    voiceEnabled: true,
    voiceBackend: "draymond",
    aetherdeskApiKey: "",
  },
];

// Load chat history from localStorage
export function loadHist() {
  try {
    const raw = storageGet(HIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Basic integrity check: must be a plain object
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      console.warn("[OpenChat] History data corrupted — resetting.");
      return {};
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] History data could not be parsed — resetting.");
    return {};
  }
}

// Save chat history to localStorage
export function saveHist(data) {
  try {
    // Enforce per-bot message limit before persisting
    const pruned = pruneHistory(data);
    const serialised = JSON.stringify(pruned);
    checkStorageQuota(serialised.length);
    storageSet(HIST_KEY, serialised);
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

/**
 * Trim each bot's message list to MAX_MESSAGES_PER_BOT, keeping the newest.
 * Returns a new object — does not mutate the input.
 */
export function pruneHistory(hist) {
  const pruned = {};
  for (const [botId, messages] of Object.entries(hist)) {
    if (!Array.isArray(messages)) {
      pruned[botId] = [];
      continue;
    }
    // Always produce a new array so callers cannot inadvertently mutate the input
    pruned[botId] = messages.slice(Math.max(0, messages.length - MAX_MESSAGES_PER_BOT));
  }
  return pruned;
}

/**
 * Warn the user when localStorage usage is approaching browser limits.
 * @param {number} incomingBytes  Byte length of the value about to be stored.
 * @param {string} excludeKey     The key about to be overwritten (excluded to avoid double-counting).
 */
function checkStorageQuota(incomingBytes, excludeKey = HIST_KEY) {
  try {
    let totalBytes = incomingBytes;
    const keys = storageKeys();
    for (const key of keys) {
      if (key !== excludeKey) {
        totalBytes += (storageGet(key) || "").length;
      }
    }
    if (totalBytes > STORAGE_WARN_BYTES) {
      console.warn(
        `[OpenChat] Storage usage ~${(totalBytes / 1024).toFixed(0)} KB — approaching browser limits.${isNative ? "" : " Consider clearing old chat history."}`
      );
    }
  } catch {
    // Non-fatal: quota check is best-effort
  }
}

// Load bot configurations from localStorage
export function loadBots() {
  try {
    const stored = storageGet(CONF_KEY);
    if (!stored) return DEFAULT_BOTS;
    const parsed = JSON.parse(stored);
    // Validate: must be a non-empty array of objects
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("[OpenChat] Bot config corrupted — resetting to defaults.");
      return DEFAULT_BOTS;
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] Bot config could not be parsed — resetting to defaults.");
    return DEFAULT_BOTS;
  }
}

// Save bot configurations to localStorage
export function saveBots(bots) {
  try {
    storageSet(CONF_KEY, JSON.stringify(bots));
  } catch (e) {
    console.error("Failed to save bots:", e);
  }
}

// Load workflows from localStorage
export function loadWorkflows() {
  try {
    const raw = storageGet(WORKFLOWS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      console.warn("[OpenChat] Workflows data corrupted — resetting.");
      return {};
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] Workflows data could not be parsed — resetting.");
    return {};
  }
}

// Save workflows to localStorage
export function saveWorkflows(data) {
  try {
    // Prune to the newest MAX_STORED_WORKFLOWS entries to prevent unbounded growth
    const pruned = pruneWorkflows(data);
    const serialised = JSON.stringify(pruned);
    checkStorageQuota(serialised.length, WORKFLOWS_KEY);
    storageSet(WORKFLOWS_KEY, serialised);
  } catch (e) {
    console.error("Failed to save workflows:", e);
  }
}

/**
 * Keep only the newest MAX_STORED_WORKFLOWS workflows.
 * Completed/failed workflows are eligible for eviction before in-progress ones.
 */
export function pruneWorkflows(workflows) {
  const entries = Object.values(workflows);
  if (entries.length <= MAX_STORED_WORKFLOWS) {
    return workflows;
  }

  // Sort: keep in-progress first, then by startTime descending (newest first)
  entries.sort((a, b) => {
    const aActive = a.status === "in_progress" ? 0 : 1;
    const bActive = b.status === "in_progress" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (b.startTime || 0) - (a.startTime || 0);
  });

  const kept = entries.slice(0, MAX_STORED_WORKFLOWS);
  const pruned = {};
  for (const wf of kept) {
    pruned[wf.id] = wf;
  }
  return pruned;
}

// Load agent registry from localStorage
export function loadAgentRegistry() {
  try {
    const raw = storageGet(AGENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      console.warn("[OpenChat] Agent registry data corrupted — resetting.");
      return {};
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] Agent registry data could not be parsed — resetting.");
    return {};
  }
}

// Save agent registry to localStorage
export function saveAgentRegistry(data) {
  try {
    // Normalise to only the fields needed for display/reconnect and cap count
    const normalised = normaliseAgentRegistry(data);
    const serialised = JSON.stringify(normalised);
    checkStorageQuota(serialised.length, AGENTS_KEY);
    storageSet(AGENTS_KEY, serialised);
  } catch (e) {
    console.error("Failed to save agent registry:", e);
  }
}

/**
 * Normalise agent records to AGENT_STORAGE_FIELDS only and cap at MAX_STORED_AGENTS.
 * Agents with the most recent heartbeat are retained when over the cap.
 */
export function normaliseAgentRegistry(registry) {
  const entries = Object.values(registry);
  // Sort by lastHeartbeat descending so we keep the most recently seen agents
  entries.sort((a, b) => (b.lastHeartbeat || 0) - (a.lastHeartbeat || 0));
  const capped = entries.slice(0, MAX_STORED_AGENTS);
  const normalised = {};
  for (const agent of capped) {
    const slim = {};
    for (const field of AGENT_STORAGE_FIELDS) {
      if (field in agent) slim[field] = agent[field];
    }
    if (slim.id) normalised[slim.id] = slim;
  }
  return normalised;
}

// Load tool execution log from localStorage
export function loadToolLog() {
  try {
    const raw = storageGet(TOOLLOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[OpenChat] Tool log data corrupted — resetting.");
      return [];
    }
    // Limit to last 1000 executions
    return parsed.slice(-1000);
  } catch {
    console.warn("[OpenChat] Tool log data could not be parsed — resetting.");
    return [];
  }
}

// Save tool execution log to localStorage
export function saveToolLog(data) {
  try {
    // Limit to last 1000 executions to prevent unbounded growth
    const limited = Array.isArray(data) ? data.slice(-1000) : [];
    storageSet(TOOLLOG_KEY, JSON.stringify(limited));
  } catch (e) {
    console.error("Failed to save tool log:", e);
  }
}

// Load mode preference from localStorage
export function loadMode() {
  try {
    const stored = storageGet(MODE_KEY);
    if (!stored) return "basic"; // Default to basic mode
    return stored === "dev" ? "dev" : "basic";
  } catch {
    return "basic";
  }
}

// Save mode preference to localStorage
export function saveMode(mode) {
  try {
    storageSet(MODE_KEY, mode);
  } catch (e) {
    console.error("Failed to save mode:", e);
  }
}

// Clear all stored data (useful for debugging)
export function clearAllStorage() {
  try {
    storageRemove(HIST_KEY);
    storageRemove(CONF_KEY);
    storageRemove(WORKFLOWS_KEY);
    storageRemove(AGENTS_KEY);
    storageRemove(TOOLLOG_KEY);
    storageRemove(MODE_KEY);
    storageRemove(TEAMS_KEY);
    storageRemove(SCHEDULES_KEY);
  } catch (e) {
    console.error("Failed to clear storage:", e);
  }
}

// Load teams from localStorage
export function loadTeams() {
  try {
    const raw = storageGet(TEAMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[OpenChat] Teams data corrupted — resetting.");
      return [];
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] Teams data could not be parsed — resetting.");
    return [];
  }
}

// Save teams to localStorage
export function saveTeams(teams) {
  try {
    const serialised = JSON.stringify(teams);
    checkStorageQuota(serialised.length, TEAMS_KEY);
    storageSet(TEAMS_KEY, serialised);
  } catch (e) {
    console.error("Failed to save teams:", e);
  }
}

// Load automation schedules from localStorage
export function loadSchedules() {
  try {
    const raw = storageGet(SCHEDULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[OpenChat] Schedules data corrupted — resetting.");
      return [];
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] Schedules data could not be parsed — resetting.");
    return [];
  }
}

// Save automation schedules to localStorage
export function saveSchedules(schedules) {
  try {
    const serialised = JSON.stringify(schedules);
    checkStorageQuota(serialised.length, SCHEDULES_KEY);
    storageSet(SCHEDULES_KEY, serialised);
  } catch (e) {
    console.error("Failed to save schedules:", e);
  }
}

// ============================================================
// Cross-chat message search
// ============================================================

/**
 * Search all chats for messages whose text contains `query` (case-insensitive).
 * Returns up to 50 results, each: { botId, message, time }.
 */
export function searchMessages(history, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const [botId, messages] of Object.entries(history || {})) {
    for (const m of messages || []) {
      const text = String(m.text || "");
      if (text.toLowerCase().includes(q)) {
        results.push({ botId, message: m, time: m.time });
        if (results.length >= 50) return results;
      }
    }
  }
  return results;
}
