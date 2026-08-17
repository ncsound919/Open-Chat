import { describe, it, expect, vi } from "vitest";
import {
  A2AServer,
  buildAgentCard,
  AGENT_CARD_PATH,
  A2A_STATUS,
} from "./A2AServer.js";

async function collectStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function parseSseText(text) {
  const matches = [...text.matchAll(/data: ({.*?})\n\n/g)].map((m) =>
    JSON.parse(m[1])
  );
  return matches;
}

describe("buildAgentCard", () => {
  it("builds a spec-compliant agent card with defaults", () => {
    const card = buildAgentCard({ name: "My Bot", baseUrl: "http://127.0.0.1:9999/" });
    expect(card.name).toBe("My Bot");
    expect(card.version).toBe("1.0.0");
    expect(card.defaultInputModes).toEqual(["text/plain"]);
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(card.supportedInterfaces[0]).toMatchObject({
      protocolBinding: "JSONRPC",
      url: "http://127.0.0.1:9999",
      protocolVersion: "1.0",
    });
    expect(card.skills).toEqual([]);
  });

  it("includes skills, icon, and honors streaming flag", () => {
    const card = buildAgentCard({
      name: "B",
      skills: [{ id: "s1", name: "S" }],
      streaming: false,
      pushNotifications: true,
      iconUrl: "https://x/icon.png",
    });
    expect(card.skills).toEqual([{ id: "s1", name: "S" }]);
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.iconUrl).toBe("https://x/icon.png");
  });
});

describe("A2AServer agent card", () => {
  it("serves the agent card and exposes it", () => {
    const server = new A2AServer({ name: "Srv", baseUrl: "http://127.0.0.1:1" });
    const res = server.handleAgentCard();
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/json");
    const card = JSON.parse(res.body);
    expect(card.name).toBe("Srv");
    expect(server.getAgentCard().name).toBe("Srv");
    expect(AGENT_CARD_PATH).toBe("/.well-known/agent-card.json");
  });
});

describe("handleJsonRpc", () => {
  it("returns a parse error for a non-object payload", async () => {
    const server = new A2AServer({ name: "S" });
    const res = await server.handleJsonRpc(null);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it("returns method-not-found for unknown methods", async () => {
    const server = new A2AServer({ name: "S" });
    const res = await server.handleJsonRpc({ id: 1, method: "Nope" });
    expect(JSON.parse(res.body).error.code).toBe(-32601);
  });

  it("returns invalid params when SendMessage has no message", async () => {
    const server = new A2AServer({ name: "S" });
    const res = await server.handleJsonRpc({ id: 1, method: "SendMessage", params: {} });
    expect(JSON.parse(res.body).error.code).toBe(-32602);
  });

  it("runs the executor synchronously when not streaming", async () => {
    const executor = vi.fn(async ({ text }) => `echo:${text}`);
    const server = new A2AServer({ name: "S", executor });
    const res = await server.handleJsonRpc(
      {
        id: 2,
        method: "SendMessage",
        params: { message: { messageId: "m1", role: "user", parts: [{ text: "hi" }] } },
      },
      { stream: false }
    );
    expect(executor).toHaveBeenCalled();
    const result = JSON.parse(res.body).result;
    expect(result.event.status).toBe(A2A_STATUS.COMPLETED);
    expect(result.event.artifacts[0].parts[0].text).toBe("echo:hi");
  });

  it("streams status and artifact updates via SSE, completing at the end", async () => {
    const executor = async ({ onChunk }) => {
      onChunk("part ");
      onChunk("two");
      return "part two";
    };
    const server = new A2AServer({ name: "S", executor });
    const res = await server.handleJsonRpc({
      id: 3,
      method: "SendMessage",
      params: { message: { messageId: "m2", role: "user", parts: [{ text: "go" }] } },
    });
    expect(res.contentType).toBe("text/event-stream");
    const text = await collectStream(res.body);
    const events = parseSseText(text);
    const statuses = events.map((e) => e.result.event.status);
    expect(statuses).toContain(A2A_STATUS.WORKING);
    expect(statuses).toContain(A2A_STATUS.COMPLETED);
    // The completed event carries the full output as an artifact.
    const completed = events.find((e) => e.result.event.status === A2A_STATUS.COMPLETED);
    const finalText = completed.result.event.artifacts
      .flatMap((a) => a.parts)
      .map((p) => p.text)
      .join("");
    expect(finalText).toBe("part two");
    // Chunk events were emitted while working.
    const chunkCount = events.filter(
      (e) =>
        e.result.event.status === A2A_STATUS.WORKING &&
        (e.result.event.artifacts || []).some((a) => a.parts.some((p) => p.text))
    ).length;
    expect(chunkCount).toBeGreaterThan(0);
  });

  it("marks a task failed when the executor throws", async () => {
    const executor = async () => {
      throw new Error("boom");
    };
    const server = new A2AServer({ name: "S", executor });
    const res = await server.handleJsonRpc(
      {
        id: 4,
        method: "SendMessage",
        params: { message: { messageId: "m3", role: "user", parts: [{ text: "x" }] } },
      },
      { stream: false }
    );
    expect(JSON.parse(res.body).result.event.status).toBe(A2A_STATUS.FAILED);
  });

  it("emits a failed status event when the streaming executor throws", async () => {
    const executor = async () => {
      throw new Error("stream boom");
    };
    const server = new A2AServer({ name: "S", executor });
    const res = await server.handleJsonRpc({
      id: 9,
      method: "SendMessage",
      params: { message: { messageId: "m5", role: "user", parts: [{ text: "x" }] } },
    });
    const text = await collectStream(res.body);
    const events = parseSseText(text);
    expect(events.some((e) => e.result.event.status === A2A_STATUS.FAILED)).toBe(true);
  });

  it("returns a task via GetTask", async () => {
    const server = new A2AServer({ name: "S" });
    server.tasks.t1 = { id: "t1", status: A2A_STATUS.WORKING, message: {}, artifacts: [] };
    const res = await server.handleJsonRpc({ id: 5, method: "GetTask", params: { id: "t1" } });
    expect(JSON.parse(res.body).result.task.status).toBe(A2A_STATUS.WORKING);
  });

  it("returns task-not-found for unknown GetTask", async () => {
    const server = new A2AServer({ name: "S" });
    const res = await server.handleJsonRpc({ id: 6, method: "GetTask", params: { id: "nope" } });
    expect(JSON.parse(res.body).error.code).toBe(-32602);
  });

  it("cancels a task and invokes the onCancel callback", async () => {
    const server = new A2AServer({ name: "S" });
    const onCancel = vi.fn();
    server.onCancel(onCancel);
    server.tasks.t2 = { id: "t2", status: A2A_STATUS.WORKING, message: {}, artifacts: [] };
    const res = await server.handleJsonRpc({ id: 7, method: "CancelTask", params: { id: "t2" } });
    expect(JSON.parse(res.body).result.task.status).toBe(A2A_STATUS.CANCELED);
    expect(onCancel).toHaveBeenCalledWith("t2");
  });

  it("uses the default echo executor when none is provided", async () => {
    const server = new A2AServer({ name: "S" });
    const res = await server.handleJsonRpc(
      {
        id: 8,
        method: "SendMessage",
        params: { message: { messageId: "m4", role: "user", parts: [{ text: "hello" }] } },
      },
      { stream: false }
    );
    expect(JSON.parse(res.body).result.event.artifacts[0].parts[0].text).toBe("hello");
  });
});
