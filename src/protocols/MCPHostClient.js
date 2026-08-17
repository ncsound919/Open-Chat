/**
 * MCP (Model Context Protocol) Host Client
 * Lets Open-Chat act as an MCP host, connecting to one or more MCP servers so
 * its agents can use standardized tools (and the Tool Execution Console can
 * inspect and invoke them).
 *
 * MCP is the open standard for agent-to-tool communication. A host initializes
 * a session with each server (capabilities negotiation), lists the tools the
 * server exposes, and invokes them. This module talks JSON-RPC 2.0 over
 * Streamable HTTP / plain HTTP.
 *
 * Methods (JSON-RPC):
 *  - initialize          - negotiate protocol version + capabilities
 *  - notifications/initialized - mark the session initialized (notification)
 *  - tools/list          - enumerate the server's tools
 *  - tools/call          - invoke a tool with arguments
 */

import { isSafeUrl, safeLog } from "../utils/security.js";

/** Default MCP protocol version advertised by this host. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Connection timeout in milliseconds. */
const CONNECT_TIMEOUT_MS = 30_000;

/** Max JSON-RPC request id. */
let _nextId = 1;

/**
 * An MCP host client that aggregates tools across multiple MCP servers.
 * @param {Array<{name: string, url: string, token?: string}>} servers
 */
export class MCPHostClient {
  constructor(servers = []) {
    this.servers = Array.isArray(servers) ? servers : [];
    this.connections = {}; // name -> { session, tools, status }
    this.status = "disconnected";
    this.onStatusChange = null;
    this.onServerChange = null;
  }

  /**
   * Connect to every configured server and discover their tools.
   * @returns {Promise<Array<{name: string, tools: Array<Object>}>>}
   */
  async connect() {
    this._setStatus("connecting");
    const results = [];
    let failed = false;

    for (const server of this.servers) {
      try {
        const info = await this._connectServer(server);
        this.connections[server.name] = info;
        results.push({ name: server.name, tools: info.tools });
        this.onServerChange?.(server.name, "connected", info.tools);
      } catch (error) {
        failed = true;
        safeLog(`Failed to connect MCP server ${server.name}`, error);
        this.onServerChange?.(server.name, "error", []);
      }
    }

    this._setStatus(failed ? "error" : "connected");
    return results;
  }

  /**
   * Connect to a single MCP server and list its tools.
   * @private
   */
  async _connectServer(server) {
    const url = this._resolveUrl(server.url);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...(server.token ? { Authorization: `Bearer ${server.token}` } : {}),
    };

    // 1. initialize
    const initResult = await this._jsonRpc(url, headers, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "open-chat", version: "1.0.0" },
    });
    const serverInfo = initResult?.serverInfo || { name: server.name };

    // 2. notifications/initialized (fire and forget)
    await this._jsonRpc(url, headers, "notifications/initialized", {}, true).catch(
      () => {}
    );

    // 3. tools/list
    const toolsResult = await this._jsonRpc(url, headers, "tools/list", {});
    const tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];

    return {
      session: {
        name: serverInfo.name || server.name,
        protocolVersion: initResult?.protocolVersion,
        capabilities: initResult?.capabilities || {},
      },
      tools,
      status: "connected",
      url,
      headers,
    };
  }

  /**
   * List all aggregated tools across connected servers.
   * @returns {Array<{server: string, name: string, description: string, inputSchema: Object}>}
   */
  listTools() {
    const out = [];
    for (const [name, conn] of Object.entries(this.connections)) {
      for (const tool of conn.tools || []) {
        out.push({
          server: name,
          name: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema || {},
        });
      }
    }
    return out;
  }

  /**
   * Get tool names grouped by server.
   * @returns {Object<string, string[]>}
   */
  getToolsByServer() {
    const out = {};
    for (const [name, conn] of Object.entries(this.connections)) {
      out[name] = (conn.tools || []).map((t) => t.name);
    }
    return out;
  }

  /**
   * Call a tool, routing to the server that exposes it.
   * @param {string} toolName
   * @param {Object} [arguments]
   * @param {string} [serverName] - Optionally pin the target server.
   * @returns {Promise<{ok: boolean, result?: Object, error?: string, server?: string}>}
   */
  async callTool(toolName, args = {}, serverName) {
    let conn = null;
    let targetName = serverName;

    if (!targetName) {
      for (const [name, c] of Object.entries(this.connections)) {
        if ((c.tools || []).some((t) => t.name === toolName)) {
          conn = c;
          targetName = name;
          break;
        }
      }
    } else {
      conn = this.connections[serverName];
    }

    if (!conn) {
      return { ok: false, error: "No connected MCP server exposes this tool" };
    }

    try {
      const result = await this._jsonRpc(conn.url, conn.headers, "tools/call", {
        name: toolName,
        arguments: args || {},
      });
      const content = Array.isArray(result?.content) ? result.content : [];
      const text = content
        .map((c) => (typeof c?.text === "string" ? c.text : ""))
        .join("");
      const isError = result?.isError === true;
      return { ok: !isError, result: text, server: targetName, raw: result };
    } catch (error) {
      safeLog("MCP tool call failed", error);
      return { ok: false, error: error.message, server: targetName };
    }
  }

  /**
   * Disconnect from all servers.
   */
  disconnect() {
    this.connections = {};
    this._setStatus("disconnected");
  }

  /**
   * Get the connected session info for a server.
   * @param {string} name
   */
  getServerInfo(name) {
    return this.connections[name]?.session || null;
  }

  /**
   * True when any server is connected.
   */
  isConnected() {
    return this.status === "connected";
  }

  /**
   * Resolve and validate a server URL.
   * @private
   */
  _resolveUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) throw new Error("MCP server URL is required");
    const normalized = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    if (!isSafeUrl(normalized)) {
      throw new Error("MCP server URL must use http(s)");
    }
    return normalized;
  }

  /**
   * Perform a single JSON-RPC request.
   * @private
   */
  async _jsonRpc(url, headers, method, params, isNotification = false) {
    const id = isNotification ? undefined : _nextId++;
    const payload = { jsonrpc: "2.0", method, params };
    if (id !== undefined) payload.id = id;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      if (isNotification) return null;
      const json = await res.json();
      if (json?.error) {
        throw new Error(json.error.message || "JSON-RPC error");
      }
      return json?.result ?? json;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Set status and notify the callback.
   * @private
   */
  _setStatus(status) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
