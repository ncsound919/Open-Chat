import { describe, it, expect, vi } from "vitest";
import { buildSkillExecutors } from "./skillExecutors.js";

function makeDeps() {
  return {
    onSend: vi.fn(),
    onNotify: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn().mockResolvedValue({ text: "local answer", provider: "mediapipe" }),
  };
}

describe("buildSkillExecutors", () => {
  it("runs text/llm/summarize through the injected chat", async () => {
    const deps = makeDeps();
    const handlers = buildSkillExecutors(deps);
    const out = await handlers.text({ prompt: "hello", pack: { name: "p" }, tool: "text" });
    expect(deps.chat).toHaveBeenCalledWith("hello", expect.any(Object));
    expect(out.ok).toBe(true);
    expect(out.output).toBe("local answer");
  });

  it("requires a prompt for text tools", async () => {
    const deps = makeDeps();
    const handlers = buildSkillExecutors(deps);
    const out = await handlers.llm({ pack: { name: "p" }, tool: "llm" });
    expect(out.ok).toBe(false);
    expect(deps.chat).not.toHaveBeenCalled();
  });

  it("falls back to pack instructions when no prompt is given", async () => {
    const deps = makeDeps();
    const handlers = buildSkillExecutors(deps);
    const out = await handlers.summarize({
      pack: { name: "p", instructions: "summarize the payload" },
      tool: "summarize",
      payload: "data",
    });
    expect(out.ok).toBe(true);
    expect(deps.chat).toHaveBeenCalledWith("summarize the payload", expect.any(Object));
  });

  it("notifies via onNotify and returns the notification", async () => {
    const deps = makeDeps();
    const handlers = buildSkillExecutors(deps);
    const out = await handlers.notify({ title: "T", body: "B", pack: { name: "p" }, tool: "notify" });
    expect(deps.onNotify).toHaveBeenCalledWith("T", "B");
    expect(out.ok).toBe(true);
  });

  it("sends text into the chat via onSend", async () => {
    const deps = makeDeps();
    const handlers = buildSkillExecutors(deps);
    const out = await handlers.send_to_chat({ text: "hi there", pack: { name: "p" }, tool: "send_to_chat" });
    expect(deps.onSend).toHaveBeenCalledWith("hi there");
    expect(out.ok).toBe(true);
  });

  it("returns pack outputs for the outputs tool", async () => {
    const handlers = buildSkillExecutors(makeDeps());
    const out = await handlers.outputs({ pack: { name: "p", outputs: ["log", "file"] }, tool: "outputs" });
    expect(out.ok).toBe(true);
    expect(out.outputs).toEqual(["log", "file"]);
  });

  it("strips the injected pack/tool keys from handler args", async () => {
    const deps = makeDeps();
    const handlers = buildSkillExecutors(deps);
    // notify reads args.title/body — pack/tool must not leak into args.
    const out = await handlers.notify({
      title: "X",
      body: "Y",
      pack: { name: "p" },
      tool: "notify",
    });
    expect(out.ok).toBe(true);
    expect(out.notified.title).toBe("X");
  });

  it("fails soft for tools unavailable on this device", async () => {
    const handlers = buildSkillExecutors(makeDeps());
    for (const name of ["email", "web", "registry"]) {
      const out = await handlers[name]({ pack: { name: "p" }, tool: name });
      expect(out.ok).toBe(false);
      expect(typeof out.error).toBe("string");
    }
  });

  it("exposes the on-device skills (current_time works without native)", async () => {
    const handlers = buildSkillExecutors(makeDeps());
    const out = await handlers.current_time({ tool: "current_time" });
    expect(out.ok).toBe(true);
    expect(typeof out.result).toBe("string");
  });

  it("uploads a capture to SMD via capture_to_smd", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, path: "C:/smd/images/capture.png", filename: "capture.png" }),
    }));
    global.fetch = fetchMock;
    const handlers = buildSkillExecutors({ ...makeDeps(), draymondBaseUrl: "https://draymond.overlay365.com", token: "tok" });
    const out = await handlers.capture_to_smd({ data: "aGVsbG8=", filename: "cap.png", tool: "capture_to_smd", pack: { name: "p" } });
    expect(out.ok).toBe(true);
    expect(out.smd_ref).toContain("capture.png");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/api/v1/marketing/media");
  });

  it("fails capture_to_smd without data or connection", async () => {
    const handlers = buildSkillExecutors(makeDeps());
    const noData = await handlers.capture_to_smd({ tool: "capture_to_smd", pack: { name: "p" } });
    expect(noData.ok).toBe(false);
    const noUrl = await handlers.capture_to_smd({ data: "aGVsbG8=", tool: "capture_to_smd", pack: { name: "p" } });
    expect(noUrl.ok).toBe(false);
  });

  it("reads the SMD publish queue via smd_queue", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, total: 2, queue: [{ id: "p1" }, { id: "p2" }] }),
    }));
    global.fetch = fetchMock;
    const handlers = buildSkillExecutors({ ...makeDeps(), draymondBaseUrl: "https://draymond.overlay365.com", token: "tok" });
    const out = await handlers.smd_queue({ tool: "smd_queue", pack: { name: "p" } });
    expect(out.ok).toBe(true);
    expect(out.total).toBe(2);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/api/v1/marketing/queue");
  });

  it("fails smd_queue without a Draymond connection", async () => {
    const handlers = buildSkillExecutors(makeDeps());
    const out = await handlers.smd_queue({ tool: "smd_queue", pack: { name: "p" } });
    expect(out.ok).toBe(false);
  });
});
