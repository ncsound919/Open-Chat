// Storage keys
const HIST_KEY = "openchat_hist_v1";
const CONF_KEY = "openchat_conf_v1";

// Safety limits
export const MAX_MESSAGES_PER_BOT = 10_000;
const STORAGE_WARN_BYTES = 4 * 1024 * 1024; // warn at 4 MB (browsers allow ~5–10 MB)

// Default bot configurations
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
    host: "127.0.0.1",
    port: 8642,
    token: "",
  },
];

// Load chat history from localStorage
export function loadHist() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
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
    localStorage.setItem(HIST_KEY, serialised);
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
 */
function checkStorageQuota(incomingBytes) {
  try {
    let totalBytes = incomingBytes;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== HIST_KEY) {
        totalBytes += (localStorage.getItem(key) || "").length;
      }
    }
    if (totalBytes > STORAGE_WARN_BYTES) {
      console.warn(
        `[OpenChat] Storage usage ~${(totalBytes / 1024).toFixed(0)} KB — approaching browser limits. Consider clearing old chat history.`
      );
    }
  } catch {
    // Non-fatal: quota check is best-effort
  }
}

// Load bot configurations from localStorage
export function loadBots() {
  try {
    const stored = localStorage.getItem(CONF_KEY);
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
    localStorage.setItem(CONF_KEY, JSON.stringify(bots));
  } catch (e) {
    console.error("Failed to save bots:", e);
  }
}

// Clear all stored data (useful for debugging)
export function clearAllStorage() {
  try {
    localStorage.removeItem(HIST_KEY);
    localStorage.removeItem(CONF_KEY);
  } catch (e) {
    console.error("Failed to clear storage:", e);
  }
}
