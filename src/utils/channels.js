/**
 * Channel management utilities
 * Supports multi-channel conversations with multiple agents
 */

import { uuid } from "./helpers.js";

/**
 * Channel types
 */
export const CHANNEL_TYPES = {
  DIRECT: "direct", // 1-on-1 with single agent
  GROUP: "group", // Multi-agent group chat
  BROADCAST: "broadcast", // One-to-many announcements
};

/**
 * Create a new channel
 * @param {string} name - Channel name
 * @param {string[]} agentIds - Array of bot IDs in this channel
 * @param {string} type - Channel type (direct/group/broadcast)
 * @param {string} createdBy - User/bot ID that created the channel
 * @returns {Object} New channel object
 */
export function createChannel(
  name,
  agentIds = [],
  type = CHANNEL_TYPES.DIRECT,
  createdBy = "user"
) {
  return {
    id: uuid(),
    name,
    type,
    agentIds, // Array of bot IDs participating in this channel
    createdBy,
    createdAt: Date.now(),
    lastMessageAt: Date.now(),
    metadata: {}, // Custom metadata for extensions
  };
}

/**
 * Check if a channel is a direct message (1-on-1)
 */
export function isDirectChannel(channel) {
  return channel.type === CHANNEL_TYPES.DIRECT && channel.agentIds.length === 1;
}

/**
 * Check if a channel is a group chat
 */
export function isGroupChannel(channel) {
  return channel.type === CHANNEL_TYPES.GROUP && channel.agentIds.length > 1;
}

/**
 * Get channel display name
 * For direct channels, use the bot name
 * For group channels, use the channel name or generate from participant names
 */
export function getChannelDisplayName(channel, bots) {
  if (isDirectChannel(channel)) {
    const bot = bots.find((b) => b.id === channel.agentIds[0]);
    return bot?.name || "Unknown Bot";
  }

  if (channel.name) {
    return channel.name;
  }

  // Generate name from participants
  const participantNames = channel.agentIds
    .map((id) => {
      const bot = bots.find((b) => b.id === id);
      return bot?.name;
    })
    .filter(Boolean)
    .slice(0, 3);

  if (participantNames.length === 0) return "Empty Channel";
  if (participantNames.length <= 2) return participantNames.join(", ");
  return `${participantNames.slice(0, 2).join(", ")} +${participantNames.length - 2}`;
}

/**
 * Get unread count for a channel
 */
export function getChannelUnreadCount(channel, history) {
  const messages = history[channel.id] || [];
  return messages.filter(
    (m) => m.role === "assistant" && !m.read && !m.error
  ).length;
}

/**
 * Get last message in a channel
 */
export function getChannelLastMessage(channel, history) {
  const messages = history[channel.id] || [];
  return messages[messages.length - 1];
}

/**
 * Migrate existing bot-based conversations to channels
 * This creates a direct channel for each existing bot
 */
export function migrateBotsToChannels(bots) {
  return bots.map((bot) =>
    createChannel(bot.name, [bot.id], CHANNEL_TYPES.DIRECT, "system")
  );
}

/**
 * Add agent to channel
 */
export function addAgentToChannel(channel, agentId) {
  if (channel.agentIds.includes(agentId)) {
    return channel; // Already in channel
  }

  return {
    ...channel,
    agentIds: [...channel.agentIds, agentId],
    type:
      channel.agentIds.length > 0 ? CHANNEL_TYPES.GROUP : CHANNEL_TYPES.DIRECT,
  };
}

/**
 * Remove agent from channel
 */
export function removeAgentFromChannel(channel, agentId) {
  const agentIds = channel.agentIds.filter((id) => id !== agentId);

  return {
    ...channel,
    agentIds,
    type: agentIds.length <= 1 ? CHANNEL_TYPES.DIRECT : CHANNEL_TYPES.GROUP,
  };
}

/**
 * Check if message mentions an agent
 * Looks for @botname or @botid patterns
 */
export function getMentionedAgents(messageText, bots) {
  const mentioned = [];
  const mentionPattern = /@(\w+)/g;
  let match;

  while ((match = mentionPattern.exec(messageText)) !== null) {
    const mention = match[1].toLowerCase();

    // Check if mention matches bot name or ID
    const bot = bots.find(
      (b) =>
        b.name.toLowerCase() === mention ||
        b.id.toLowerCase() === mention ||
        b.id.toLowerCase().startsWith(mention)
    );

    if (bot && !mentioned.includes(bot.id)) {
      mentioned.push(bot.id);
    }
  }

  return mentioned;
}

/**
 * Highlight mentions in message text
 * Wraps @mentions in a special marker for UI rendering
 */
export function highlightMentions(messageText, bots) {
  const mentionPattern = /@(\w+)/g;

  return messageText.replace(mentionPattern, (mention, name) => {
    const normalizedName = name.toLowerCase();
    const bot = bots.find(
      (b) =>
        b.name.toLowerCase() === normalizedName ||
        b.id.toLowerCase() === normalizedName ||
        b.id.toLowerCase().startsWith(normalizedName)
    );

    if (!bot) {
      return mention;
    }

    return `<mention data-bot-id="${bot.id}">${mention}</mention>`;
  });
}
