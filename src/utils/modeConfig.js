/**
 * Mode configuration for Open-Chat
 * Defines what features are available in Basic vs Dev mode
 */

export const MODES = {
  BASIC: 'basic',
  DEV: 'dev'
};

/**
 * Field visibility rules for each mode
 */
export const FIELD_VISIBILITY = {
  // Settings fields
  protocol: { basic: false, dev: true },
  host: { basic: false, dev: true },
  port: { basic: false, dev: true },
  token: { basic: false, dev: true },
  connectionInfo: { basic: false, dev: true },
  deleteBot: { basic: false, dev: true },

  // Inbox features
  protocolBadge: { basic: false, dev: true },
  statusIndicator: { basic: true, dev: true },

  // Chat features
  workflowTracking: { basic: false, dev: true },
  toolLogs: { basic: false, dev: true }
};

/**
 * Default bot configuration for Basic mode
 */
export const BASIC_MODE_DEFAULTS = {
  protocol: 'hermes',
  host: '127.0.0.1',
  port: 8642,
  token: ''
};

/**
 * Check if a field should be visible in the current mode
 */
export function isFieldVisible(fieldName, mode) {
  const visibility = FIELD_VISIBILITY[fieldName];
  if (!visibility) return true; // Show by default if not configured
  return visibility[mode] ?? true;
}

/**
 * Get default configuration based on mode
 */
export function getModeDefaults(mode) {
  return mode === MODES.BASIC ? BASIC_MODE_DEFAULTS : {};
}

/**
 * Get available protocols for the current mode
 */
export function getAvailableProtocols(mode) {
  if (mode === MODES.BASIC) {
    return ['hermes']; // Basic mode only supports Hermes
  }
  return ['hermes', 'openclaw', 'uplift-bridge', 'subteam', 'draymond'];
}

/**
 * Get mode display name
 */
export function getModeLabel(mode) {
  return mode === MODES.BASIC ? 'Basic' : 'Dev';
}
