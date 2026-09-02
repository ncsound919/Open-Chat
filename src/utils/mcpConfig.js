/**
 * MCP server configuration helpers.
 * An Open-Chat bot configured as an MCP host stores its server list as a JSON
 * string on the bot (`mcpServers`). These helpers parse/serialize that string.
 */

/**
 * Parse a bot's MCP server list into an array of server configs.
 * Accepts a JSON array string, a parsed array, or an empty value.
 * @param {string|Array|null} raw
 * @returns {Array<{name: string, url: string, token?: string}>}
 */
export function parseMcpServers(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((s) => s && typeof s === "object" && s.name && s.url)
      .map((s) => ({
        name: String(s.name),
        url: String(s.url),
        token: typeof s.token === "string" ? s.token : "",
      }));
  }
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parseMcpServers(parsed);
  } catch {
    return [];
  }
}

/**
 * Build a friendly display label for the aggregated tools.
 * @param {Object<string, string[]>} byServer
 * @returns {string}
 */
export function summarizeMcpTools(byServer) {
  const parts = [];
  for (const [name, tools] of Object.entries(byServer || {})) {
    parts.push(`${name} (${tools.length})`);
  }
  return parts.join(", ") || "No servers connected";
}
