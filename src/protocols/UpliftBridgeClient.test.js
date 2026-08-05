import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpliftBridgeClient, upliftBridgeHealthCheck } from "./UpliftBridgeClient.js";

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

    c._destroyed = true;
    c.polling = false;
    c._startPolling(); // destroyed -> early return
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

  it("streams SSE chunks when the bridge responds with text/event-stream", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
            "data: rawtext\n",
            "data: [DONE]\n",
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

  it("ends streaming when the SSE reader reports done without a [DONE] marker", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        null,
        {
          headers: { "content-type": "text/event-stream" },
          body: streamFromChunks([
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
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
            'data: {"text":"via text"}\n',
            "data: {}\n",
            "data: [DONE]\n",
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

describe("disconnect", () => {
  it("deregisters the environment and resets state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const c = new UpliftBridgeClient("127.0.0.1", 8642, "oauth");
    c.environmentId = "env1";
    c.environmentSecret = "sec1";
    c.sessionId = "sess-1";
    c.sessionToken = "st-1";
    c.pollTimer = setTimeout(() => {}, 10_000);

    c.disconnect();

    expect(c._destroyed).toBe(true);
    expect(c.polling).toBe(false);
    expect(c.pollTimer).toBeNull();
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
