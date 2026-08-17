import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpliftBridgeClient, upliftBridgeHealthCheck, buildEventStreamUrl } from "./UpliftBridgeClient.js";
import {
  decodeWorkSecret,
  encodeWorkSecret,
  parseSSEFrames,
  sameSessionId,
  buildSdkUrl,
  buildCCRv2SdkUrl,
  convertSSEUrlToPostUrl,
} from "./bridge-protocol.js";

const encoder = new TextEncoder();

function streamFromChunks(chunks) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) return { value: encoder.encode(chunks[i++]), done: false };
        return { value: undefined, done: true };
      },
      releaseLock: vi.fn(),
      cancel: vi.fn().mockResolvedValue(),
    }),
  };
}

function jsonResponse(payload, { headers = {}, ok = true, status = 200, statusText = "OK", body } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => payload,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body,
  };
}

function httpError(status, statusText = "Error") {
  return jsonResponse(null, { ok: false, status, statusText });
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSessionClient() {
  const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
  c.sessionId = "sess-1";
  c.sessionToken = "st-1";
  return c;
}

describe("connect", () => {
  it("registers the environment and starts polling", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ environment_id: "env1", environment_secret: "sec1" }))
      .mockResolvedValue(jsonResponse({ data: null }));

    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);

    await c.connect();
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(c.environmentId).toBe("env1");
    expect(c.environmentSecret).toBe("sec1");

    const [regUrl, regInit] = fetchMock.mock.calls[0];
    expect(String(regUrl)).toBe("http://127.0.0.1:8642/v1/environments/bridge");
    expect(regInit.method).toBe("POST");
    expect(regInit.headers.Authorization).toBe("Bearer oauth");
    expect(regInit.headers["anthropic-version"]).toBe("2023-06-01");
    const regBody = JSON.parse(regInit.body);
    expect(regBody.machine_name).toBe("open-chat-client");
    expect(regBody.metadata.worker_type).toBe("chat");

    // Wait for the initial poll to complete.
    await new Promise((r) => setTimeout(r, 10));
    const [pollUrl, pollInit] = fetchMock.mock.calls[1];
    expect(String(pollUrl)).toBe("http://127.0.0.1:8642/v1/environments/env1/work/poll");
    expect(pollInit.method).toBe("GET");
    expect(pollInit.headers.Authorization).toBe("Bearer sec1");

    c.disconnect();
  });

  it("sends reuseEnvironmentId for idempotent re-registration", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ environment_id: "env1", environment_secret: "sec1" }))
      .mockResolvedValue(jsonResponse({ data: null }));

    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    await c.connect({ reuseEnvironmentId: "env0" });
    const regBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(regBody.environment_id).toBe("env0");
    c.disconnect();
  });

  it("throws when the client is destroyed", async () => {
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c._destroyed = true;
    await expect(c.connect()).rejects.toThrow("Client destroyed");
  });

  it("throws and reports error when registration fails", async () => {
    fetchMock.mockResolvedValueOnce(httpError(503));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    await expect(c.connect()).rejects.toThrow("Registration failed: 503");
    expect(statuses).toEqual(["connecting", "error"]);
  });

  it("throws and reports error on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    await expect(c.connect()).rejects.toThrow("network down");
    expect(statuses).toEqual(["connecting", "error"]);
  });

  it("_startPolling is a no-op when already polling or destroyed", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ environment_id: "e", environment_secret: "s" }))
      .mockResolvedValue(jsonResponse({ data: null }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    await c.connect();
    const calls = fetchMock.mock.calls.length;
    c._startPolling(); // polling === true -> early return
    expect(fetchMock.mock.calls.length).toBe(calls);
    c.disconnect();
  });

  it("_poll returns early when not polling or destroyed", async () => {
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    await c._poll();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("_handleWork", () => {
  it("captures session info, acks, and surfaces user messages", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    const inbound = vi.fn();
    c.onInboundMessage = inbound;

    await c._handleWork({
      id: "w1",
      data: {
        type: "session_start",
        id: "sess-1",
        session_token: "st-1",
        messages: [
          { role: "user", content: "hi there" },
          { role: "assistant", content: "not user" },
          { role: "user", content: "" },
        ],
      },
    });

    expect(c.sessionId).toBe("sess-1");
    expect(c.sessionToken).toBe("st-1");
    expect(c.pendingMessages).toEqual([{ role: "user", content: "hi there" }]);
    expect(inbound).toHaveBeenCalledTimes(1);
    expect(inbound).toHaveBeenCalledWith({ role: "user", content: "hi there" });

    const [ackUrl, ackInit] = fetchMock.mock.calls[0];
    expect(String(ackUrl)).toBe("http://127.0.0.1:8642/v1/environments/env1/work/w1/ack");
    expect(ackInit.method).toBe("POST");
    expect(ackInit.headers.Authorization).toBe("Bearer st-1");
  });

  it("decodes the base64url work secret and uses the session ingress token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const secret = encodeWorkSecret({
      version: 1,
      session_ingress_token: "ingress-tok",
      api_base_url: "http://127.0.0.1:8642",
    });
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    const inbound = vi.fn();
    c.onInboundMessage = inbound;

    await c._handleWork({
      id: "w7",
      data: {
        type: "session",
        id: "sess-2",
        messages: [{ role: "user", content: "over secret" }],
      },
      secret,
    });

    expect(c.sessionId).toBe("sess-2");
    expect(c.sessionToken).toBe("ingress-tok");
    expect(c.sessionApiBaseUrl).toBe("http://127.0.0.1:8642");
    expect(c.activeWorkId).toBe("w7");
    expect(inbound).toHaveBeenCalledWith({ role: "user", content: "over secret" });

    // Ack uses the decoded ingress token.
    const [ackUrl, ackInit] = fetchMock.mock.calls[0];
    expect(String(ackUrl)).toBe("http://127.0.0.1:8642/v1/environments/env1/work/w7/ack");
    expect(ackInit.headers.Authorization).toBe("Bearer ingress-tok");

    c._stopHeartbeat();
    c.disconnect();
  });

  it("keeps polling heartbeats while a session work item is active", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.sessionToken = "st-1";

    await c._handleWork({
      id: "w-heartbeat",
      data: { type: "session", id: "sess-3", messages: [] },
      secret: encodeWorkSecret({
        version: 1,
        session_ingress_token: "st-1",
        api_base_url: "http://127.0.0.1:8642",
      }),
    });

    expect(c.heartbeatTimer).not.toBeNull();
    c.disconnect();
    expect(c.heartbeatTimer).toBeNull();
  });

  it("acks with the environment secret before a session is established", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    const inbound = vi.fn();
    c.onInboundMessage = inbound;

    await c._handleWork({ id: "w9", data: { type: "ping", messages: [{ role: "user", content: "yo" }] } });
    expect(inbound).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sec1");
  });

  it("does nothing when there are no messages", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    const inbound = vi.fn();
    c.onInboundMessage = inbound;

    await c._handleWork({ id: "w2", data: { type: "heartbeat" } });
    expect(inbound).not.toHaveBeenCalled();
    expect(c.pendingMessages).toEqual([]);
  });

  it("logs when the ack request fails", async () => {
    fetchMock.mockRejectedValue(new Error("ack down"));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await c._handleWork({ id: "w3", data: { messages: [] } });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("heartbeat", () => {
  it("_sendHeartbeat posts to the work heartbeat endpoint with the session token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ lease_extended: true, state: "running" }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.sessionToken = "st-1";
    c.activeWorkId = "w-hb";

    await c._sendHeartbeat("w-hb");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/v1/environments/env1/work/w-hb/heartbeat");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer st-1");
  });

  it("stops heartbeating when the server reports a terminal state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ lease_extended: false, state: "completed" }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.sessionToken = "st-1";
    c.activeWorkId = "w-done";
    c.heartbeatTimer = setInterval(() => {}, 60_000);

    await c._sendHeartbeat("w-done");

    expect(c.heartbeatTimer).toBeNull();
    expect(c.activeWorkId).toBeNull();
  });
});

describe("stop", () => {
  it("force-stops the active work item and clears the heartbeat", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.sessionToken = "st-1";
    c.activeWorkId = "w-stop";
    c.heartbeatTimer = setInterval(() => {}, 60_000);

    await c.stop(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/v1/environments/env1/work/w-stop/stop");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ force: true });
    expect(c.activeWorkId).toBeNull();
    expect(c.heartbeatTimer).toBeNull();
  });

  it("is a no-op without an active work item", async () => {
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    await c.stop();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("polling", () => {
  it("polls for work and schedules the next poll", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { messages: [{ role: "user", content: "inbound" }] } })
      )
      .mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.onInboundMessage = vi.fn();

    c.polling = true;
    await c._poll();
    expect(c.onInboundMessage).toHaveBeenCalledWith({
      role: "user",
      content: "inbound",
    });
    expect(c.pollTimer).not.toBeNull();
    c.disconnect();
  });

  it("logs poll errors and keeps polling", async () => {
    fetchMock.mockRejectedValue(new Error("poll down"));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    c.polling = true;
    await c._poll();
    expect(error).toHaveBeenCalled();
    expect(c.pollTimer).not.toBeNull();
    error.mockRestore();
    c.disconnect();
  });
});

describe("send", () => {
  it("posts the message and returns the non-streaming result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: "the reply" }, { headers: { "content-type": "application/json" } })
    );
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hello", (x) => chunks.push(x));

    expect(result).toBe("the reply");
    expect(chunks).toEqual(["the reply"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/v1/sessions/sess-1/events");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer st-1");
    expect(JSON.parse(init.body)).toEqual({ type: "message", role: "assistant", content: "hello" });
  });

  it("sends session events to the api_base_url from the work secret", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: "via ingress" }, { headers: { "content-type": "application/json" } })
    );
    const c = makeSessionClient();
    c.sessionApiBaseUrl = "http://127.0.0.1:9000";
    const chunks = [];
    await c.send("hello", (x) => chunks.push(x));

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:9000/v1/sessions/sess-1/events");
  });

  it("streams SSE chunks when the bridge responds with text/event-stream", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            "data: rawtext\n\n",
            "data: [DONE]\n\n",
          ]),
        }
      )
    );
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("Hellorawtext");
    expect(chunks).toEqual(["Hello", "rawtext"]);
  });

  it("streams SSE frames split across chunks", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'data: {"choices":[{"delta":{"conte',
            'nt":"Hello"}}]}\n\ndata: [DONE]\n\n',
          ]),
        }
      )
    );
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("Hello");
    expect(chunks).toEqual(["Hello"]);
  });

  it("ends streaming when the SSE reader reports done without a [DONE] marker", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
          ]),
        }
      )
    );
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("partial");
    expect(chunks).toEqual(["partial"]);
  });

  it("uses the parsed.text field and ignores empty SSE payloads", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'data: {"text":"via text"}\n\n',
            "data: {}\n\n",
            "data: [DONE]\n\n",
          ]),
        }
      )
    );
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("via text");
    expect(chunks).toEqual(["via text"]);
  });

  it("tracks sequence numbers from SSE frame ids", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'id: 7\ndata: {"text":"seqd"}\n\n',
            "data: [DONE]\n\n",
          ]),
        }
      )
    );
    const c = makeSessionClient();
    const result = await c.send("hi", vi.fn());

    expect(result).toBe("seqd");
    expect(c.lastSequenceNum).toBe(7);
  });

  it("treats a response without a content-type header as non-streaming", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: "plain reply" }));
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("plain reply");
    expect(chunks).toEqual(["plain reply"]);
  });

  it("uses the message field when the non-streaming body has no content", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "the msg" }, { headers: { "content-type": "application/json" } })
    );
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("the msg");
    expect(chunks).toEqual(["the msg"]);
  });

  it("returns empty when the non-streaming body cannot be parsed", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => {
        throw new Error("bad json");
      },
    });
    const c = makeSessionClient();
    const chunks = [];
    const result = await c.send("hi", (x) => chunks.push(x));

    expect(result).toBe("");
    expect(chunks).toEqual([]);
  });

  it("stops streaming early when the external signal is already aborted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(null, { headers: { "content-type": "text/event-stream" }, body: streamFromChunks([]) })
    );
    const c = makeSessionClient();
    const controller = new AbortController();
    controller.abort();
    const result = await c.send("hi", vi.fn(), controller.signal);
    expect(result).toBe("");
  });

  it("adds and removes the external abort listener when the signal is live", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: "ok" }, { headers: { "content-type": "application/json" } })
    );
    const c = makeSessionClient();
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    await c.send("hi", vi.fn(), controller.signal);
    expect(addSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("aborts the in-flight request when the external signal fires", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        })
    );
    const c = makeSessionClient();
    const controller = new AbortController();
    const promise = c.send("hi", vi.fn(), controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow("aborted");
  });

  it("throws when there is no active session", async () => {
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    await expect(c.send("hi", vi.fn())).rejects.toThrow(
      "No active session - check connection"
    );
  });

  it("throws when the bridge POST fails", async () => {
    fetchMock.mockResolvedValueOnce(httpError(400));
    const c = makeSessionClient();
    await expect(c.send("hi", vi.fn())).rejects.toThrow("Bridge send failed: 400");
  });
});

describe("connectEventStream", () => {
  it("does nothing without an established session", async () => {
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.connectEventStream();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the event stream and surfaces client_event payloads", async () => {
    const frames = [
      "event: client_event\nid: 3\ndata: " +
        JSON.stringify({
          event_id: "e1",
          sequence_num: 3,
          event_type: "client_event",
          payload: { type: "user_message", message: { role: "user", content: "live msg" } },
        }) +
        "\n\n",
    ];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(null, {
        headers: { "content-type": "text/event-stream" },
        body: streamFromChunks(frames),
      })
    );

    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.sessionId = "sess-1";
    c.sessionToken = "st-1";
    const inbound = vi.fn();
    const onEvent = vi.fn();
    c.onInboundMessage = inbound;
    c.onEvent = onEvent;

    c.connectEventStream();
    await new Promise((r) => setTimeout(r, 20));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/v2/session_ingress/session/sess-1/events/stream"
    );
    expect(init.headers.Authorization).toBe("Bearer st-1");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(c.lastSequenceNum).toBe(3);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(inbound).toHaveBeenCalledWith({ role: "user", content: "live msg" });

    c.disconnect();
  });

  it("sends Last-Event-ID when resuming from a sequence number", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(null, {
        headers: { "content-type": "text/event-stream" },
        body: streamFromChunks([]),
      })
    );
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.sessionId = "sess-1";
    c.sessionToken = "st-1";
    c.lastSequenceNum = 42;

    c.connectEventStream();
    await new Promise((r) => setTimeout(r, 20));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("from_sequence_num=42");
    expect(init.headers["Last-Event-ID"]).toBe("42");
    c.disconnect();
  });

  it("closes the stream on disconnect", async () => {
    // A persistent stream that never ends (open connection).
    let resolveNever;
    const neverDone = new Promise((r) => (resolveNever = r));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(null, {
        headers: { "content-type": "text/event-stream" },
        body: {
          getReader: () => ({
            read: async () => await neverDone,
            releaseLock: vi.fn(),
            cancel: vi.fn().mockResolvedValue(),
          }),
        },
      })
    );
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.sessionId = "sess-1";
    c.sessionToken = "st-1";
    c.connectEventStream();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.eventSource).not.toBeNull();
    c.disconnect();
    expect(c.eventSource).toBeNull();
    resolveNever();
  });
});

describe("disconnect", () => {
  it("deregisters the environment and resets state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.sessionId = "sess-1";
    c.sessionToken = "st-1";
    c.pollTimer = setTimeout(() => {}, 10_000);
    c.heartbeatTimer = setInterval(() => {}, 60_000);

    c.disconnect();

    expect(c._destroyed).toBe(true);
    expect(c.polling).toBe(false);
    expect(c.pollTimer).toBeNull();
    expect(c.heartbeatTimer).toBeNull();
    expect(c.environmentId).toBeNull();
    expect(c.environmentSecret).toBeNull();
    expect(c.sessionId).toBeNull();
    expect(c.sessionToken).toBeNull();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/v1/environments/bridge/env1");
    expect(init.method).toBe("DELETE");
  });

  it("ignores deregistration errors", async () => {
    fetchMock.mockRejectedValue(new Error("delete down"));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.environmentId = "env1";
    expect(() => c.disconnect()).not.toThrow();
  });

  it("skips deregistration when there is no environment", async () => {
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "");
    c.disconnect();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("upliftBridgeHealthCheck", () => {
  it("returns true when the health endpoint is ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const ok = await upliftBridgeHealthCheck("127.0.0.1", 8642, "tok", 500);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8642/v1/health");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("returns false on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(httpError(500));
    expect(await upliftBridgeHealthCheck("127.0.0.1", 8642, "")).toBe(false);
  });

  it("returns false when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await upliftBridgeHealthCheck("127.0.0.1", 8642, "")).toBe(false);
  });
});

describe("bridge-protocol", () => {
  it("decodeWorkSecret validates version 1 and required fields", () => {
    const secret = encodeWorkSecret({
      version: 1,
      session_ingress_token: "tok-abc",
      api_base_url: "https://api.example.com",
    });
    const decoded = decodeWorkSecret(secret);
    expect(decoded).toEqual({
      version: 1,
      session_ingress_token: "tok-abc",
      api_base_url: "https://api.example.com",
    });
  });

  it("decodeWorkSecret rejects a bad version", () => {
    const secret = encodeWorkSecret({ version: 2, session_ingress_token: "x", api_base_url: "y" });
    expect(() => decodeWorkSecret(secret)).toThrow("Unsupported work secret version");
  });

  it("decodeWorkSecret rejects missing fields", () => {
    const secret = encodeWorkSecret({ version: 1 });
    expect(() => decodeWorkSecret(secret)).toThrow("session_ingress_token");
  });

  it("decodeWorkSecret rejects non-JSON input", () => {
    expect(() => decodeWorkSecret("not-json")).toThrow(/base64url JSON|Invalid/);
  });

  it("parseSSEFrames parses multi-line data and comments", () => {
    const buffer =
      ": keepalive\n\n" +
      'event: client_event\nid: 1\ndata: {"a":1}\n\n' +
      'event: msg\ndata: line1\ndata: line2\n\n' +
      "partial";
    const { frames, remaining } = parseSSEFrames(buffer);
    expect(remaining).toBe("partial");
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({}); // comment-only frame
    expect(frames[1]).toEqual({ event: "client_event", id: "1", data: '{"a":1}' });
    expect(frames[2]).toEqual({ event: "msg", data: "line1\nline2" });
  });

  it("sameSessionId compares tagged-id bodies", () => {
    expect(sameSessionId("session_abc123", "cse_abc123")).toBe(true);
    expect(sameSessionId("cse_staging_xyz9", "session_xyz9")).toBe(true);
    expect(sameSessionId("session_abc", "session_def")).toBe(false);
    expect(sameSessionId("session_abc", "abc")).toBe(false); // body too short
    expect(sameSessionId("a", "b")).toBe(false);
  });

  it("buildSdkUrl picks v2/ws for localhost and v1/wss for remote", () => {
    expect(buildSdkUrl("http://127.0.0.1:8642", "sess-1")).toBe(
      "ws://127.0.0.1:8642/v2/session_ingress/ws/sess-1"
    );
    expect(buildSdkUrl("https://api.example.com", "sess-1")).toBe(
      "wss://api.example.com/v1/session_ingress/ws/sess-1"
    );
  });

  it("buildCCRv2SdkUrl points at /v1/code/sessions", () => {
    expect(buildCCRv2SdkUrl("http://127.0.0.1:8642", "sess-1")).toBe(
      "http://127.0.0.1:8642/v1/code/sessions/sess-1"
    );
  });

  it("convertSSEUrlToPostUrl drops the /stream suffix", () => {
    expect(
      convertSSEUrlToPostUrl("https://api.example.com/v2/session_ingress/session/s/events/stream")
    ).toBe("https://api.example.com/v2/session_ingress/session/s/events");
  });

  it("buildEventStreamUrl includes from_sequence_num when set", () => {
    const url = buildEventStreamUrl("http://127.0.0.1:8642", "sess-1", 9);
    expect(url).toContain("/v2/session_ingress/session/sess-1/events/stream");
    expect(url).toContain("from_sequence_num=9");
  });
});
