// Storage keys
const HIST_KEY = "openchat_hist_v1";
const CONF_KEY = "openchat_conf_v1";

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
    return JSON.parse(localStorage.getItem(HIST_KEY) || "{}");
  } catch {
    return {};
  }
}

// Save chat history to localStorage
export function saveHist(data) {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

// Load bot configurations from localStorage
export function loadBots() {
  try {
    const stored = localStorage.getItem(CONF_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_BOTS;
  } catch {
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
