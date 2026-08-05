import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NtfyClient } from "./NtfyClient.js";

describe("NtfyClient resolveBaseUrl", () => {
  it("uses full URLs as-is", () => {
    const c = new NtfyClient("https://ntfy.example.com", 80, "", "topic");
    expect(c.baseUrl).toBe("https://ntfy.example.com");
  });

  it("builds http:// for local hosts", () => {
    const c = new NtfyClient("localhost", 8090, "", "topic");
    expect(c.baseUrl).toBe("http://localhost:8090");
  });

  it("builds https:// for remote hosts", () => {
    const c = new NtfyClient("ntfy.example.com", 443, "", "topic");
    expect(c.baseUrl).toBe("https://ntfy.example.com:443");
  });

  it("defaults local port to 80", () => {
    const c = new NtfyClient("127.0.0.1", "", "", "topic");
    expect(c.baseUrl).toBe("http://127.0.0.1:80");
  });
});

describe("NtfyClient connect", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires a topic", async () => {
    const c = new NtfyClient("localhost", 80, "", "");
    await expect(c.connect()).rejects.toThrow("topic is required");
  });

  it("sends bearer auth when token present", async () => {
    const body = {
      getReader: () => ({
        read: async () => ({ value: undefined, done: true }),
        releaseLock: () => {},
      }),
    };
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    const c = new NtfyClient("localhost", 80, "tok123", "alerts");
    await c.connect();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/alerts/json?since=");
    expect(init.headers["Authorization"]).toBe("Bearer tok123");
  });

  it("throws and schedules reconnect on HTTP error", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403, statusText: "Forbidden" }));
    const c = new NtfyClient("localhost", 80, "", "alerts");
    await expect(c.connect()).rejects.toThrow("HTTP 403");
  });

  it("parses message lines and invokes onMessage", async () => {
    const lines = [
      "{}\n",
      '{"event":"message","id":"m1","title":"T","message":"Body","actions":[{"action":"http","label":"Go"}]}\n',
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
    // Plain response-like object: `new Response(stream)` loses `.body` under
    // vitest's undici, so pass the stream through an explicit body field.
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", body: stream });

    const onMessage = vi.fn();
    const c = new NtfyClient("localhost", 80, "", "alerts");
    c.onMessage = onMessage;
    await c.connect();
    await new Promise((r) => setTimeout(r, 50));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", title: "T", message: "Body" })
    );
  });
});

describe("NtfyClient publish", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when no topic", async () => {
    const c = new NtfyClient("localhost", 80, "", "");
    expect(await c.publish({ message: "hi" })).toBe(false);
  });

  it("posts to the root URL with topic in body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const c = new NtfyClient("https://ntfy.example.com", 80, "", "alerts");
    const ok = await c.publish({
      title: "T",
      message: "M",
      priority: 5,
      tags: ["wrench"],
      actions: [{ action: "http", label: "Go", url: "https://x" }],
    });
    expect(ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ntfy.example.com");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body);
    expect(payload.topic).toBe("alerts");
    expect(payload.title).toBe("T");
    expect(payload.priority).toBe(5);
  });

  it("caps actions at 3", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const c = new NtfyClient("https://ntfy.example.com", 80, "", "alerts");
    await c.publish({
      actions: [1, 2, 3, 4].map((i) => ({ action: "view", label: String(i) })),
    });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.actions.length).toBe(3);
  });

  it("returns false when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const c = new NtfyClient("https://ntfy.example.com", 80, "", "alerts");
    expect(await c.publish({ message: "hi" })).toBe(false);
  });
});

describe("NtfyClient executeAction", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid actions", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction(null);
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported action types", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "teleport" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unsupported");
  });

  it("blocks unsafe view URLs", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "view", url: "javascript:alert(1)" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  it("opens safe view URLs", async () => {
    const openSpy = vi.fn();
    const originalOpen = global.window?.open;
    Object.defineProperty(global, "window", { value: { open: openSpy }, configurable: true });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "view", url: "https://example.com" });
    expect(result.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    if (originalOpen === undefined) delete global.window;
  });

  it("copies a value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(global.navigator, "clipboard", { value: { writeText }, configurable: true });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "copy", clipboard: "hello" });
    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    delete global.navigator.clipboard;
  });

  it("copy action rejects empty values", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "copy" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Nothing to copy");
  });

  it("copy action handles clipboard errors", async () => {
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "copy", clipboard: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Clipboard unavailable");
    delete global.navigator.clipboard;
  });

  it("blocks unsafe http action URLs", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({
      action: "http",
      url: "file:///etc/passwd",
      method: "POST",
      body: "{}",
    });
    expect(result.ok).toBe(false);
  });

  it("posts approve action with headers and body (Draymond approval relay)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ action: { status: "approved" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({
      action: "http",
      label: "Approve",
      url: "https://draymond.example.com/api/v1/actions/abc/review",
      method: "POST",
      headers: { "X-Review-Token": "tok", "Content-Type": "application/json" },
      body: '{"approved":true}',
    });
    expect(result.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://draymond.example.com/api/v1/actions/abc/review");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Review-Token"]).toBe("tok");
    expect(init.body).toBe('{"approved":true}');
    expect(result.output).toContain("approved");
  });

  it("reports error detail from failed http response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Action not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "http", url: "https://x.com", method: "POST" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
    expect(result.error).toContain("Action not found");
  });

  it("handles copy action via clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "copy", clipboard: "secret" });
    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("secret");
  });

  it("handles broadcast action as in-app echo", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "broadcast", label: "Confirmed" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Confirmed");
  });
});

describe("NtfyClient connect edge cases", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
  });

  it("throws when the stream body is missing", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const c = new NtfyClient("localhost", 80, "", "alerts");
    await expect(c.connect()).rejects.toThrow("Stream body not available");
    c._shouldReconnect = false;
    c.disconnect();
  });

  it("reconnects when the stream fails unexpectedly", async () => {
    const body = {
      getReader: () => ({
        read: async () => { throw new Error("stream broke"); },
        releaseLock: () => {},
      }),
    };
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", body });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    await c.connect();
    await new Promise((r) => setTimeout(r, 10));
    expect(statuses).toContain("disconnected");
    expect(c._reconnectTimerId).not.toBeNull();
    c._shouldReconnect = false;
    c.disconnect();
  });

  it("disconnects cleanly and clears all state", async () => {
    const c = new NtfyClient("localhost", 80, "", "alerts");
    c._reconnectTimerId = setTimeout(() => {}, 10_000);
    const reader = { cancel: vi.fn().mockResolvedValue() };
    c._reader = reader;
    c._controller = new AbortController();
    const abortSpy = vi.spyOn(c._controller, "abort");
    const statuses = [];
    c.onStatusChange = (s) => statuses.push(s);
    c.disconnect();
    expect(statuses).toEqual(["disconnected"]);
    expect(reader.cancel).toHaveBeenCalled();
    expect(abortSpy).toHaveBeenCalled();
    expect(c._reader).toBeNull();
    expect(c._controller).toBeNull();
    expect(c._reconnectTimerId).toBeNull();
    expect(c._shouldReconnect).toBe(false);
  });

  it("truncates an oversized NDJSON buffer", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`{"a":"${"x".repeat(1_100_000)}"}\n`));
        controller.close();
      },
    });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    c._controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await c._consumeStream(stream, c._controller.signal);
    warn.mockRestore();
  });

  it("skips malformed NDJSON lines", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("this is not json\n"));
        controller.close();
      },
    });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    c._controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await c._consumeStream(stream, c._controller.signal);
    warn.mockRestore();
  });

  it("fires the reconnect timer and reconnects", async () => {
    vi.useFakeTimers();
    const body = {
      getReader: () => ({
        read: async () => ({ value: undefined, done: true }),
        releaseLock: () => {},
      }),
    };
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", body });
    const c = new NtfyClient("localhost", 80, "", "alerts");
    c._shouldReconnect = true;
    c._scheduleReconnect();
    await vi.advanceTimersByTimeAsync(3000);
    expect(c._reconnectTimerId).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("skips reconnecting when reconnect is disabled", async () => {
    vi.useFakeTimers();
    const c = new NtfyClient("localhost", 80, "", "alerts");
    c._shouldReconnect = true;
    c._scheduleReconnect();
    c._shouldReconnect = false;
    await vi.advanceTimersByTimeAsync(3000);
    expect(c._reconnectTimerId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("NtfyClient executeAction http details", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds a default Content-Type when a body is sent without one", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({
      action: "http",
      url: "https://example.com/api",
      method: "POST",
      body: '{"a":1}',
    });
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("handles a non-ok http action with a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(new Response("plain text error", { status: 500 }));
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "http", url: "https://example.com/api" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns a server message from an http action response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Done!" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "http", url: "https://example.com/api" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Done!");
  });

  it("keeps the default output when an http action returns no JSON", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "http", url: "https://example.com/api" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Request succeeded");
  });

  it("returns an error message when the http action fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const c = new NtfyClient("localhost", 80, "", "alerts");
    const result = await c.executeAction({ action: "http", url: "https://example.com/api" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("network down");
  });
});
