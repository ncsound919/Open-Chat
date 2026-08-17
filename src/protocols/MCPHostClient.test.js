import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPHostClient, MCP_PROTOCOL_VERSION } from "./MCPHostClient.js";

let fetchImpl;

beforeEach(() => {
  fetchImpl = vi.fn();
  vi.stubGlobal("fetch", fetchImpl);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonOk(result) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ jsonrpc: "2.0", result }),
  });
}

/**
 * A mock MCP server that answers initialize / tools/list / tools/call based on
 * the request method.
 */
function mockServer({ serverName = "srv", tools = [{ name: "echo" }] } = {}) {
  fetchImpl.mockImplementation((url, { body }) => {
    const parsed = JSON.parse(body);
    switch (parsed.method) {
      case "initialize":
        return jsonOk({
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: serverName },
          capabilities: { tools: {} },
        });
      case "notifications/initialized":
        return Promise.resolve({ ok: true, status: 200, statusText: "OK" });
      case "tools/list":
        return jsonOk({ tools });
      case "tools/call":
        return jsonOk({
          content: [{ type: "text", text: "tool-result" }],
          isError: false,
        });
      default:
        return jsonOk({});
    }
  });
}

describe("MCPHostClient constructor", () => {
  it("stores servers and initializes state", () => {
    const c = new MCPHostClient([{ name: "a", url: "http://x" }]);
    expect(c.servers).toHaveLength(1);
    expect(c.status).toBe("disconnected");
    expect(c.connections).toEqual({});
  });
});

describe("connect", () => {
  it("initializes, lists tools, and aggregates across servers", async () => {
    const c = new MCPHostClient([
      { name: "s1", url: "http://127.0.0.1:8000", token: "tok" },
      { name: "s2", url: "https://mcp.example.com" },
    ]);
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    const changes = [];
    c.onServerChange = (name, st, tools) => changes.push({ name, st, tools });

    let callCount = 0;
    fetchImpl.mockImplementation((_url, { body }) => {
      const parsed = JSON.parse(body);
      const serverIdx = callCount < 3 ? "s1" : "s2";
      callCount++;
      const serverName = serverIdx === "s1" ? "srvOne" : "srvTwo";
      switch (parsed.method) {
        case "initialize":
          return jsonOk({
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: serverName },
            capabilities: {},
          });
        case "notifications/initialized":
          return Promise.resolve({ ok: true, status: 200 });
        case "tools/list":
          return jsonOk({ tools: [{ name: `tool-${serverName}` }] });
        default:
          return jsonOk({});
      }
    });

    const results = await c.connect();

    expect(statuses).toEqual(["connecting", "connected"]);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("s1");
    expect(results[0].tools).toEqual([{ name: "tool-srvOne" }]);
    expect(changes).toHaveLength(2);
    expect(c.getServerInfo("s1").name).toBe("srvOne");
  });

  it("marks status error and records the failed server when one fails", async () => {
    const c = new MCPHostClient([
      { name: "good", url: "http://x" },
      { name: "bad", url: "http://y" },
    ]);
    mockServer({ serverName: "Good" });
    // make the second server fail on initialize
    let n = 0;
    const original = fetchImpl.getMockImplementation();
    fetchImpl.mockImplementation((url, opts) => {
      if (n >= 3) return Promise.resolve({ ok: false, status: 500, statusText: "x" });
      n++;
      return original(url, opts);
    });
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    await c.connect();
    expect(statuses).toContain("error");
    expect(c.getServerInfo("good").name).toBe("Good");
    expect(c.getServerInfo("bad")).toBeNull();
  });
});

describe("listTools / getToolsByServer", () => {
  it("aggregates tools across servers", async () => {
    const c = new MCPHostClient([
      { name: "s1", url: "http://a" },
      { name: "s2", url: "http://b" },
    ]);
    let n = 0;
    fetchImpl.mockImplementation((_u, { body }) => {
      const p = JSON.parse(body);
      const idx = n++ < 3 ? 0 : 1;
      const sname = idx === 0 ? "One" : "Two";
      if (p.method === "initialize")
        return jsonOk({ serverInfo: { name: sname }, capabilities: {} });
      if (p.method === "notifications/initialized")
        return Promise.resolve({ ok: true, status: 200 });
      if (p.method === "tools/list")
        return jsonOk({ tools: [{ name: `t-${sname}`, description: "d", inputSchema: {} }] });
      return jsonOk({});
    });
    await c.connect();

    const tools = c.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].server).toBe("s1");
    expect(tools[0].name).toBe("t-One");

    expect(c.getToolsByServer()).toEqual({ s1: ["t-One"], s2: ["t-Two"] });
  });
});

describe("callTool", () => {
  it("routes to the server that exposes the tool and returns text content", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    mockServer({ serverName: "Srv", tools: [{ name: "echo" }] });
    await c.connect();

    const res = await c.callTool("echo", { x: 1 });
    expect(res.ok).toBe(true);
    expect(res.result).toBe("tool-result");
    expect(res.server).toBe("s1");
  });

  it("pins to a server when serverName is provided", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    mockServer({ serverName: "Srv", tools: [{ name: "echo" }] });
    await c.connect();
    const res = await c.callTool("echo", {}, "s1");
    expect(res.ok).toBe(true);
  });

  it("returns an error when no server exposes the tool", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    mockServer({ serverName: "Srv", tools: [{ name: "other" }] });
    await c.connect();
    const res = await c.callTool("missing", {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No connected MCP server/);
  });

  it("marks the result failed when the server returns isError", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    fetchImpl.mockImplementation((_u, { body }) => {
      const p = JSON.parse(body);
      if (p.method === "initialize")
        return jsonOk({ serverInfo: { name: "Srv" }, capabilities: {} });
      if (p.method === "notifications/initialized")
        return Promise.resolve({ ok: true, status: 200 });
      if (p.method === "tools/list") return jsonOk({ tools: [{ name: "boom" }] });
      return jsonOk({ content: [], isError: true });
    });
    await c.connect();
    const res = await c.callTool("boom", {});
    expect(res.ok).toBe(false);
  });

  it("returns an error when the server replies with a JSON-RPC error", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    fetchImpl.mockImplementation((_u, { body }) => {
      const p = JSON.parse(body);
      if (p.method === "initialize")
        return jsonOk({ serverInfo: { name: "Srv" }, capabilities: {} });
      if (p.method === "notifications/initialized")
        return Promise.resolve({ ok: true, status: 200 });
      if (p.method === "tools/list") return jsonOk({ tools: [{ name: "boom" }] });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ jsonrpc: "2.0", id: p.id, error: { message: "boom" } }),
      });
    });
    await c.connect();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await c.callTool("boom", {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
    log.mockRestore();
  });

  it("uses a generic message when the JSON-RPC error has none", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    fetchImpl.mockImplementation((_u, { body }) => {
      const p = JSON.parse(body);
      if (p.method === "initialize")
        return jsonOk({ serverInfo: { name: "Srv" }, capabilities: {} });
      if (p.method === "notifications/initialized")
        return Promise.resolve({ ok: true, status: 200 });
      if (p.method === "tools/list")
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ jsonrpc: "2.0", id: p.id, error: {} }),
        });
      return jsonOk({});
    });
    await c.connect();
    expect(c.listTools()).toEqual([]);
  });
});

describe("disconnect / info / validation", () => {
  it("disconnect clears connections and sets status", async () => {
    const c = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    mockServer();
    await c.connect();
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    c.disconnect();
    expect(c.connections).toEqual({});
    expect(statuses).toContain("disconnected");
  });

  it("isConnected reflects status", async () => {
    const c = new MCPHostClient([]);
    expect(c.isConnected()).toBe(false);
    mockServer();
    const c2 = new MCPHostClient([{ name: "s1", url: "http://a" }]);
    await c2.connect();
    expect(c2.isConnected()).toBe(true);
  });

  it("rejects missing and non-http(s) server URLs", () => {
    const c = new MCPHostClient([]);
    expect(() => c._resolveUrl("")).toThrow("URL is required");
    expect(() => c._resolveUrl("javascript:alert(1)")).toThrow("must use http(s)");
  });

  it("prepends http:// to bare host:port URLs", () => {
    const c = new MCPHostClient([]);
    expect(c._resolveUrl("127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
  });
});
