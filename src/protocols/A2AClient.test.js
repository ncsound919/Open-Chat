import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { A2AClient, TASK_STATUS } from "./A2AClient.js";

function sseEvent(result) {
  return `data: ${JSON.stringify({ jsonrpc: "2.0", result: { event: result } })}\n\n`;
}

function streamFrom(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

let fetchImpl;
let defaultJsonRpcUrl = "https://agent.example.com/a2a/jsonrpc";

beforeEach(() => {
  fetchImpl = vi.fn();
  // Default card response so connect() works unless a test overrides it.
  fetchImpl.mockResolvedValue(cardResponse());
  vi.stubGlobal("fetch", fetchImpl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function okJson(body, extra = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    body: null,
    ...extra,
  });
}

function cardResponse(card = {}) {
  return okJson(
    {
      name: "Test Agent",
      version: "1.0.0",
      skills: [{ id: "s1", name: "Skill One", description: "desc" }],
      supportedInterfaces: [
        { protocolBinding: "JSONRPC", url: defaultJsonRpcUrl, protocolVersion: "1.0" },
      ],
      ...card,
    }
  );
}

describe("A2AClient constructor", () => {
  it("stores the agent card URL and token and initializes state", () => {
    const c = new A2AClient("https://agent.example.com", "tok");
    expect(c.agentCardUrl).toBe("https://agent.example.com");
    expect(c.token).toBe("tok");
    expect(c.status).toBe("disconnected");
    expect(c.skills).toEqual([]);
    expect(c.agentCard).toBeNull();
    expect(c.jsonRpcUrl).toBeNull();
  });
});

describe("_resolveAgentCardUrl", () => {
  it("resolves a base URL to the well-known agent card path", () => {
    const c = new A2AClient("https://agent.example.com", "");
    expect(c._resolveAgentCardUrl()).toBe(
      "https://agent.example.com/.well-known/agent-card.json"
    );
  });

  it("keeps an explicit agent-card.json URL", () => {
    const c = new A2AClient("https://agent.example.com/agent-card.json", "");
    expect(c._resolveAgentCardUrl()).toBe("https://agent.example.com/agent-card.json");
  });

  it("throws when the URL is missing", () => {
    const c = new A2AClient("", "");
    expect(() => c._resolveAgentCardUrl()).toThrow("Agent Card URL is required");
  });

  it("throws for a non-http(s) URL", () => {
    const c = new A2AClient("javascript:alert(1)", "");
    expect(() => c._resolveAgentCardUrl()).toThrow("must use http(s)");
  });
});

describe("connect", () => {
  it("fetches the agent card, discovers skills, and selects the JSON-RPC interface", async () => {
    const c = new A2AClient("https://agent.example.com", "tok");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    const discovered = [];
    c.onAgentDiscovered = (card) => discovered.push(card);

    fetchImpl.mockResolvedValue(cardResponse());

    const card = await c.connect();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://agent.example.com/.well-known/agent-card.json",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok" },
      })
    );
    expect(card.name).toBe("Test Agent");
    expect(c.skills).toEqual([{ id: "s1", name: "Skill One", description: "desc" }]);
    expect(c.jsonRpcUrl).toBe(defaultJsonRpcUrl);
    expect(c.status).toBe("connected");
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(discovered).toEqual([card]);
  });

  it("falls back to the first interface when JSON-RPC is absent", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    fetchImpl.mockResolvedValue(
      cardResponse({
        supportedInterfaces: [{ protocolBinding: "HTTP_JSON", url: "https://x/a2a" }],
      })
    );
    await c.connect();
    expect(c.jsonRpcUrl).toBe("https://x/a2a");
  });

  it("falls back to the card origin when no interfaces are listed", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    fetchImpl.mockResolvedValue(cardResponse({ supportedInterfaces: [] }));
    await c.connect();
    expect(c.jsonRpcUrl).toBe("https://agent.example.com/a2a/jsonrpc");
  });

  it("throws and sets status to error when the card fetch fails", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    fetchImpl.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    await expect(c.connect()).rejects.toThrow("HTTP 404");
    expect(statuses).toEqual(["connecting", "error"]);
  });

  it("throws on an invalid agent card", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    fetchImpl.mockResolvedValue(okJson({ version: "1.0" }));
    await expect(c.connect()).rejects.toThrow("Invalid Agent Card");
  });

  it("rejects when the card fetch times out", async () => {
    vi.useFakeTimers();
    const c = new A2AClient("https://agent.example.com", "");
    fetchImpl.mockImplementation((_url, { signal }) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Aborted")));
      });
    });
    const promise = c.connect();
    vi.advanceTimersByTime(30_000);
    await expect(promise).rejects.toThrow();
  });
});

describe("send", () => {
  it("streams task updates and artifacts, resolving with the final text", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    const chunks = [];

    fetchImpl.mockImplementation((_url, { body }) => {
      const parsed = JSON.parse(body);
      expect(parsed.method).toBe("SendMessage");
      expect(parsed.params.message.parts[0].text).toBe("hello");
      return okJson(
        { ok: true },
        {
          body: streamFrom([
            sseEvent({ id: parsed.params.message.messageId, status: TASK_STATUS.WORKING }),
            sseEvent({
              id: parsed.params.message.messageId,
              status: TASK_STATUS.COMPLETED,
              artifacts: [{ parts: [{ text: "final answer" }] }],
            }),
          ]),
        }
      );
    });

    const result = await c.send("hello", (chunk) => chunks.push(chunk));

    expect(result.text).toBe("final answer");
    expect(result.status).toBe(TASK_STATUS.COMPLETED);
    expect(chunks).toEqual(["final answer"]);
    expect(c.activeTasks[result.taskId]).toBeUndefined(); // pruned after terminal
  });

  it("accumulates message parts when artifact update contains multiple parts", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    let msgId;
    fetchImpl.mockImplementation((_url, { body }) => {
      msgId = JSON.parse(body).params.message.messageId;
      return okJson(
        { ok: true },
        {
          body: streamFrom([
            sseEvent({
              id: msgId,
              status: TASK_STATUS.COMPLETED,
              artifacts: [
                { parts: [{ text: "a" }, { text: "b" }] },
              ],
            }),
          ]),
        }
      );
    });

    const result = await c.send("hi", vi.fn());
    expect(result.text).toBe("ab");
  });

  it("handles a synchronous (non-streaming) JSON-RPC response", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    const chunks = [];
    fetchImpl.mockResolvedValue(
      okJson({
        jsonrpc: "2.0",
        result: {
          event: {
            status: TASK_STATUS.COMPLETED,
            artifacts: [{ parts: [{ text: "sync answer" }] }],
          },
        },
      })
    );
    const result = await c.send("hi", (ch) => chunks.push(ch));
    expect(result.text).toBe("sync answer");
    expect(chunks).toEqual(["sync answer"]);
  });

  it("throws when not connected", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await expect(c.send("hi", vi.fn())).rejects.toThrow("Not connected");
  });

  it("throws when the client is destroyed", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    c.disconnect();
    await expect(c.send("hi", vi.fn())).rejects.toThrow("Client destroyed");
  });

  it("marks the task failed and rethrows on a non-ok response", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    fetchImpl.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });
    await expect(c.send("hi", vi.fn())).rejects.toThrow("HTTP 500");
  });

  it("flushes a trailing SSE event without a terminating blank line", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    let msgId;
    fetchImpl.mockImplementation((_u, { body }) => {
      msgId = JSON.parse(body).params.message.messageId;
      const encoder = new TextEncoder();
      const eventData = JSON.stringify({
        jsonrpc: "2.0",
        result: {
          event: {
            id: msgId,
            status: TASK_STATUS.COMPLETED,
            artifacts: [{ parts: [{ text: "flush" }] }],
          },
        },
      });
      // No trailing \n\n — parsed only when the stream flushes at the end.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${eventData}`));
          controller.close();
        },
      });
      return okJson({ ok: true }, { body: stream });
    });
    const result = await c.send("hi", vi.fn());
    expect(result.text).toBe("flush");
    expect(result.status).toBe(TASK_STATUS.COMPLETED);
  });

  it("stops gracefully when the stream ends before a terminal status", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Only a working event — the stream closes without a terminal status.
        controller.enqueue(
          encoder.encode(sseEvent({ id: "x", status: TASK_STATUS.WORKING }))
        );
        controller.close();
      },
    });
    fetchImpl.mockResolvedValue(okJson({ ok: true }, { body: stream }));
    const result = await c.send("hi", vi.fn());
    expect(result.status).toBe(TASK_STATUS.WORKING);
    expect(result.text).toBe("");
  });
});

describe("getTask / cancelTask", () => {
  it("fetches a task and updates tracked state", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    fetchImpl.mockResolvedValue(
      okJson({ jsonrpc: "2.0", result: { task: { id: "t1", status: TASK_STATUS.WORKING } } })
    );
    const updates = [];
    c.onTaskUpdate = (t) => updates.push(t);
    const task = await c.getTask("t1");
    expect(task.id).toBe("t1");
    expect(c.activeTasks.t1.status).toBe(TASK_STATUS.WORKING);
    expect(updates[0].id).toBe("t1");
  });

  it("cancels a task", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    fetchImpl.mockResolvedValue(
      okJson({ jsonrpc: "2.0", result: { task: { id: "t1", status: TASK_STATUS.CANCELED } } })
    );
    const task = await c.cancelTask("t1");
    expect(task.status).toBe(TASK_STATUS.CANCELED);
  });

  it("returns null when getTask fails", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    fetchImpl.mockResolvedValue({ ok: false, status: 500, statusText: "x" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await c.getTask("t1")).toBeNull();
    log.mockRestore();
  });
});

describe("skills and disconnect", () => {
  it("returns discovered skills", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    expect(c.getSkills()).toHaveLength(1);
    expect(c.getSkills()[0].name).toBe("Skill One");
  });

  it("disconnect clears tasks and sets status", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    c.activeTasks.t1 = { id: "t1", status: TASK_STATUS.WORKING };
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    c.disconnect();
    expect(c._destroyed).toBe(true);
    expect(c.activeTasks).toEqual({});
    expect(statuses).toContain("disconnected");
  });
});

describe("terminal task pruning", () => {
  it("prunes old active tasks beyond the cap", async () => {
    const c = new A2AClient("https://agent.example.com", "");
    await c.connect();
    for (let i = 0; i < 250; i++) {
      c.activeTasks[`t${i}`] = { id: `t${i}`, status: TASK_STATUS.WORKING };
    }
    c._finalizeTask("new", TASK_STATUS.WORKING);
    expect(Object.keys(c.activeTasks).length).toBeLessThanOrEqual(200);
  });
});
