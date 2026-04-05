// Generate a simple UUID
export function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Format timestamp for display
export function ts() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Status labels and colors
export const STATUS_LABEL = {
  connected: "online",
  connecting: "connecting…",
  disconnected: "offline",
  error: "error",
};

export const STATUS_COLOR = {
  connected: "#22c55e",
  connecting: "#f59e0b",
  disconnected: "#555568",
  error: "#ef4444",
};

// Format unread count (cap at 9+)
export function formatUnread(count) {
  if (count === 0) return null;
  if (count > 9) return "9+";
  return count.toString();
}

// Get last message from conversation history
export function getLastMessage(history, botId) {
  const messages = history[botId] || [];
  return messages[messages.length - 1] || null;
}

// Get unread count for a bot
export function getUnreadCount(history, botId) {
  return (history[botId] || []).filter((m) => m.role === "bot" && !m._seen)
    .length;
}

// Mark all messages as seen for a bot
export function markAllSeen(history, botId) {
  return {
    ...history,
    [botId]: (history[botId] || []).map((m) => ({ ...m, _seen: true })),
  };
}
