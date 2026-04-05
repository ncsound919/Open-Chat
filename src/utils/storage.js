// Storage keys
const HIST_KEY = "openchat_hist_v1";
const CONF_KEY = "openchat_conf_v1";
const WORKFLOWS_KEY = "openchat_workflows_v1";
const AGENTS_KEY = "openchat_agents_v1";
const TOOLLOG_KEY = "openchat_toollog_v1";
const MODE_KEY = "openchat_mode_v1";
const CHANNELS_KEY = "openchat_channels_v1";

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
 * @param {string} excludeKey     The key about to be overwritten (excluded to avoid double-counting).
 */
function checkStorageQuota(incomingBytes, excludeKey = HIST_KEY) {
  try {
    let totalBytes = incomingBytes;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== excludeKey) {
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

// Load workflows from localStorage
export function loadWorkflows() {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY);
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
    localStorage.setItem(WORKFLOWS_KEY, serialised);
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
    const raw = localStorage.getItem(AGENTS_KEY);
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
    localStorage.setItem(AGENTS_KEY, serialised);
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
    const raw = localStorage.getItem(TOOLLOG_KEY);
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
    localStorage.setItem(TOOLLOG_KEY, JSON.stringify(limited));
  } catch (e) {
    console.error("Failed to save tool log:", e);
  }
}

// Load mode preference from localStorage
export function loadMode() {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (!stored) return "basic"; // Default to basic mode
    return stored === "dev" ? "dev" : "basic";
  } catch {
    return "basic";
  }
}

// Save mode preference to localStorage
export function saveMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch (e) {
    console.error("Failed to save mode:", e);
  }
}

// Clear all stored data (useful for debugging)
export function clearAllStorage() {
  try {
    localStorage.removeItem(HIST_KEY);
    localStorage.removeItem(CONF_KEY);
    localStorage.removeItem(WORKFLOWS_KEY);
    localStorage.removeItem(AGENTS_KEY);
    localStorage.removeItem(TOOLLOG_KEY);
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(CHANNELS_KEY);
  } catch (e) {
    console.error("Failed to clear storage:", e);
  }
}

// Load channels from localStorage
export function loadChannels() {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[OpenChat] Channels data corrupted — resetting.");
      return [];
    }
    return parsed;
  } catch {
    console.warn("[OpenChat] Channels data could not be parsed — resetting.");
    return [];
  }
}

// Save channels to localStorage
export function saveChannels(channels) {
  try {
    const serialised = JSON.stringify(channels);
    checkStorageQuota(serialised.length, CHANNELS_KEY);
    localStorage.setItem(CHANNELS_KEY, serialised);
  } catch (e) {
    console.error("Failed to save channels:", e);
  }
}
