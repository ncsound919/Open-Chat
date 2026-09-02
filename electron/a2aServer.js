/**
 * A2A (Agent2Agent) server for the Electron main process.
 * Exposes Open-Chat to the wider agent network over a real HTTP endpoint:
 *
 *   GET  http://127.0.0.1:18644/.well-known/agent-card.json  -> Agent Card
 *   POST http://127.0.0.1:18644/a2a/jsonrpc                  -> JSON-RPC (SSE when streamed)
 *
 * Reuses the transport-agnostic A2AServer from src/a2a/A2AServer.js and binds
 * it to a Node http server, so any A2A client (LangGraph, CrewAI, Semantic
 * Kernel, another Open-Chat, ...) can discover this hub and delegate tasks.
 */

import http from "node:http";
import { A2AServer } from "../src/a2a/A2AServer.js";

/** Default port for the A2A hub. */
export const DEFAULT_A2A_PORT = 18644;

/**
 * Create (but do not start) an http server backed by an A2AServer.
 * @param {Object} options - name, description, version, baseUrl, skills, executor, port
 * @returns {import('node:http').Server}
 */
export function createA2AServer(options = {}) {
  const a2a = new A2AServer({
    name: options.name,
    description: options.description,
    version: options.version,
    baseUrl: options.baseUrl,
    skills: options.skills,
    executor: options.executor,
    streaming: options.streaming !== false,
  });

  return http.createServer((req, res) => {
    // A client aborting mid-stream makes res.write() emit an 'error' event.
    // Without a listener that becomes an uncaught exception that kills the
    // whole Electron process. Swallow it here; the pump stops on 'close'.
    res.on("error", () => {});
    handle(req, res, a2a).catch((err) => {
      // Avoid leaking any details into the wire.
      console.error("[OpenChat] A2A handler error:", err?.message || err);
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" } }));
      } else {
        res.end();
      }
    });
  });
}

/**
 * Route an incoming request to the A2A server.
 * @private
 */
async function handle(req, res, a2a) {
  const host = req.headers.host || "127.0.0.1";
  const url = new URL(req.url || "/", `http://${host}`);

  // Agent Card discovery.
  if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
    const card = a2a.handleAgentCard();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return res.end(card.body);
  }

  // Health check (useful for tooling / load balancers).
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }

  // JSON-RPC endpoint (SendMessage / GetTask / CancelTask).
  if (req.method === "POST" && url.pathname === "/a2a/jsonrpc") {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }));
    }

    const wantsStream = (req.headers.accept || "").includes("text/event-stream");
    const result = await a2a.handleJsonRpc(payload, { stream: wantsStream });

    if (result.contentType === "text/event-stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const reader = result.body.getReader();
      let closed = false;
      const shutdown = () => {
        if (closed) return;
        closed = true;
        reader.cancel().catch(() => {});
        if (!res.writableEnded) res.destroy();
      };
      req.on("close", shutdown);
      const pump = () => {
        if (closed) return;
        reader
          .read()
          .then(({ done, value }) => {
            if (closed) return;
            if (done) {
              if (!res.writableEnded) res.end();
              return;
            }
            res.write(Buffer.from(value));
            pump();
          })
          .catch(() => {
            if (!res.writableEnded) res.end();
          });
      };
      return pump();
    }

    res.writeHead(result.status || 200, {
      "Content-Type": "application/json; charset=utf-8",
    });
    return res.end(result.body);
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

/**
 * Read the full request body (capped to avoid abuse).
 * @private
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_048_576) {
        req.destroy(new Error("Payload too large"));
        reject(new Error("Payload too large"));
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Start the A2A server on the given port/host.
 * @param {Object} options
 * @returns {Promise<import('node:http').Server>}
 */
export function startA2AServer(options = {}) {
  const port = Number(options.port) || DEFAULT_A2A_PORT;
  const host = options.host || "127.0.0.1";
  const server = createA2AServer(options);
  return new Promise((resolve, reject) => {
    let settled = false;
    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
        return;
      }
      // Post-listen server errors (e.g. socket failures) must not become an
      // uncaught exception that kills the Electron process.
      console.error("[OpenChat] A2A server error:", err?.message || err);
    });
    server.listen(port, host, () => {
      settled = true;
      resolve(server);
    });
  });
}
