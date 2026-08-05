import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "./OpenClawClient.js";

const MAX = 10; // mirrors MAX_RECONNECT_ATTEMPTS
const HUGE = "x".repeat(1_048_577); // > MAX_MESSAGE_BYTES

let wsInstances;
let MockWebSocket;

beforeEach(() => {
  wsInstances = [];
  MockWebSocket = class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      wsInstances.push(this);
    }

    send(data) {
      this.sent.push(data);
    }

    close() {
      if (this.readyState !== MockWebSocket.CLOSED) {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({});
      }
    }

    emitOpen() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }

    emitMessage(data) {
      this.onmessage?.({ data });
    }

    emitError() {
      this.onerror?.({});
    }
  };
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function lastSent(ws) {
  return JSON.parse(ws.sent[ws.sent.length - 1]);
}

async function connectAndOpen({ token = "tok", host = "127.0.0.1", port = 18789, hello } = {}) {
  const client = new OpenClawClient(host, port, token);
  const statuses = [];
  client.onStatusChange = (s) => statuses.push(s);
  const promise = client.connect();
  const ws = wsInstances[wsInstances.length - 1];
  ws.emitOpen();
  ws.emitMessage(
    JSON.stringify(
      hello ?? { type: "res", payload: { type: "hello-ok" } }
    )
  );
  await promise;
  return { client, ws, statuses };
}

describe("OpenClawClient constructor", () => {
  it("builds the WebSocket url and initializes state", () => {
    const c = new OpenClawClient("127.0.0.1", 18789, "tok");
    expect(c.url).toBe("ws://127.0.0.1:18789");
    expect(c.token).toBe("tok");
    expect(c.ws).toBeNull();
    expect(c.pendingReqs.size).toBe(0);
    expect(c._destroyed).toBe(false);
    expect(c.deviceToken).toBeNull();
  });

  it("uses wss for remote hosts", () => {
    const c = new OpenClawClient("claw.example.com", 18789, "");
    expect(c.url).toBe("wss://claw.example.com:18789");
  });
});

describe("connect", () => {
  it("sends the connect handshake and resolves on hello-ok", async () => {
    const client = new OpenClawClient("127.0.0.1", 18789, "tok");
    const statuses = [];
    client.onStatusChange = (s) => statuses.push(s);
    const promise = client.connect();
    const ws = wsInstances[0];

    ws.emitOpen();
    const req = lastSent(ws);
    expect(req.type).toBe("req");
    expect(req.method).toBe("connect");
    expect(req.params.minProtocol).toBe(3);
    expect(req.params.maxProtocol).toBe(3);
    expect(req.params.role).toBe("operator");
    expect(req.params.scopes).toEqual(["chat"]);
    expect(req.params.client).toMatchObject({ id: "openchat", version: "1.0.0" });
    expect(req.params.auth).toEqual({ token: "tok" });

    ws.emitMessage(JSON.stringify({ type: "res", payload: { type: "hello-ok" } }));
    await promise;
    expect(statuses).toEqual(["connected"]);
    expect(client._reconnectAttempts).toBe(0);
  });

  it("omits auth when no token and stores the device token", async () => {
    const { client, ws } = await connectAndOpen({
      token: "",
      hello: {
        type: "res",
        payload: { type: "hello-ok", auth: { deviceToken: "dev-1" } },
      },
    });
    const req = JSON.parse(ws.sent[0]);
    expect(req.params.auth).toBeUndefined();
    expect(client.deviceToken).toBe("dev-1");
  });

  it("rejects when the server responds with a connection error", async () => {
    const client = new OpenClawClient("127.0.0.1", 18789, "tok");
    const statuses = [];
    client.onStatusChange = (s) => statuses.push(s);
    const promise = client.connect();
    const ws = wsInstances[0];
    ws.emitOpen();
    ws.emitMessage(
      JSON.stringify({ type: "res", error: { message: "bad handshake" } })
    );
    await expect(promise).rejects.toThrow("bad handshake");
    expect(statuses).toEqual(["error"]);
  });

  it("rejects on a websocket error event", async () => {
    const client = new OpenClawClient("127.0.0.1", 18789, "");
    const promise = client.connect();
    const ws = wsInstances[0];
    ws.emitError();
    await expect(promise).rejects.toThrow("WebSocket error");
  });

  it("rejects when the client has been destroyed", async () => {
    const client = new OpenClawClient("127.0.0.1", 18789, "");
    client._destroyed = true;
    await expect(client.connect()).rejects.toThrow("Client destroyed");
  });

  it("rejects when max reconnect attempts is reached", async () => {
    const client = new OpenClawClient("127.0.0.1", 18789, "");
    client._reconnectAttempts = MAX;
    const statuses = [];
    client.onStatusChange = (s) => statuses.push(s);
    await expect(client.connect()).rejects.toThrow("Max reconnect attempts");
    expect(statuses).toEqual(["error"]);
  });

  it("rejects on the connection handshake timeout", async () => {
    vi.useFakeTimers();
    const client = new OpenClawClient("127.0.0.1", 18789, "");
    const promise = client.connect();
    vi.advanceTimersByTime(30_000);
    await expect(promise).rejects.toThrow("Connection timed out");
    client.disconnect();
  });
});

describe("send", () => {
  it("resolves with the final summary after streaming deltas", async () => {
    const { client, ws } = await connectAndOpen();
    const chunks = [];
    const promise = client.send("hello there", (c) => chunks.push(c));

    const req = lastSent(ws);
    expect(req.type).toBe("req");
    expect(req.method).toBe("chat.send");
    expect(req.params.text).toBe("hello there");
    expect(typeof req.params.idempotencyKey).toBe("string");

    const id = req.id;

    // chat.send ack provides the runId
    ws.emitMessage(
      JSON.stringify({ type: "res", id, method: "chat.send", payload: { runId: "r2" } })
    );
    // streaming deltas that match the runId
    ws.emitMessage(
      JSON.stringify({ type: "event", event: "agent", payload: { delta: "first ", runId: "r2" } })
    );
    // text fallback path
    ws.emitMessage(
      JSON.stringify({ type: "event", event: "agent", payload: { text: "second", runId: "r2" } })
    );
    // final agent response
    ws.emitMessage(
      JSON.stringify({ type: "res", id, method: "agent", payload: { summary: "final" } })
    );

    await expect(promise).resolves.toBe("final");
    expect(chunks).toEqual(["first ", "second"]);
    expect(client.pendingReqs.size).toBe(0);
  });

  it("matches an agent event with no runId to the earliest pending request", async () => {
    const { client, ws } = await connectAndOpen();
    const chunks = [];
    const promise = client.send("hi", (c) => chunks.push(c));
    const id = lastSent(ws).id;

    ws.emitMessage(
      JSON.stringify({ type: "event", event: "agent", payload: { delta: "d1" } })
    );
    ws.emitMessage(
      JSON.stringify({ type: "res", id, method: "agent", payload: { summary: "s" } })
    );
    await expect(promise).resolves.toBe("s");
    expect(chunks).toEqual(["d1"]);
  });

  it("rejects when the socket is not open", async () => {
    const client = new OpenClawClient("127.0.0.1", 18789, "");
    await expect(client.send("hi", vi.fn())).rejects.toThrow(
      "Not connected - check Settings"
    );
  });

  it("rejects when the client has been disconnected", async () => {
    const { client } = await connectAndOpen();
    client.disconnect();
    await expect(client.send("hi", vi.fn())).rejects.toThrow(
      "Not connected - check Settings"
    );
  });
});

describe("message handling edge cases", () => {
  it("rejects oversized messages via safeLog", async () => {
    const { ws } = await connectAndOpen();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    ws.emitMessage(HUGE);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("ignores malformed JSON messages", async () => {
    const { ws } = await connectAndOpen();
    expect(() => ws.emitMessage("{not json")).not.toThrow();
  });

  it("ignores unknown event types without a pending request", async () => {
    const { ws } = await connectAndOpen();
    expect(() =>
      ws.emitMessage(JSON.stringify({ type: "event", event: "unknown", payload: {} }))
    ).not.toThrow();
  });
});

describe("disconnect and reconnect", () => {
  it("disconnect closes the socket and clears pending state", async () => {
    const { client, ws } = await connectAndOpen();
    client.pendingReqs.set("x", { resolve: vi.fn() });
    const closeSpy = vi.spyOn(ws, "close");

    client.disconnect();
    expect(client._destroyed).toBe(true);
    expect(client.ws).toBeNull();
    expect(client.pendingReqs.size).toBe(0);
    expect(closeSpy).toHaveBeenCalled();
  });

  it("schedules an automatic reconnect after close with backoff", async () => {
    vi.useFakeTimers();
    const { client, ws } = await connectAndOpen();
    const statuses = [];
    client.onStatusChange = (s) => statuses.push(s);

    ws.close();
    expect(statuses).toContain("disconnected");
    expect(client._reconnectAttempts).toBe(1);
    expect(client._reconnectTimer).not.toBeNull();

    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(statuses).toContain("connecting");
    expect(wsInstances.length).toBe(2);
    client.disconnect();
  });

  it("reports error when close happens after max reconnect attempts", async () => {
    const { client, ws } = await connectAndOpen();
    const statuses = [];
    client.onStatusChange = (s) => statuses.push(s);
    client._reconnectAttempts = MAX;

    ws.close();
    expect(statuses).toEqual(["disconnected", "error"]);
    client.disconnect();
  });
});
