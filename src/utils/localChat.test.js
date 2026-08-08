import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildGemmaPrompt,
  cleanReply,
  parseToolCall,
  buildToolSchema,
  PROVIDER,
} from "./localChat.js";

vi.mock("./modelRegistry.js", () => ({
  loadMediaPipe: vi.fn(async () => null),
}));

describe("buildGemmaPrompt", () => {
  it("builds a system + user + model turn", () => {
    const prompt = buildGemmaPrompt("Be helpful", [{ role: "user", content: "hi" }]);
    expect(prompt).toContain("<start_of_turn>user");
    expect(prompt).toContain("Be helpful");
    expect(prompt).toContain("hi");
    expect(prompt).toContain("<end_of_turn>");
    expect(prompt.trim().endsWith("<start_of_turn>model")).toBe(true);
  });

  it("does not duplicate the model turn after an assistant message", () => {
    const prompt = buildGemmaPrompt("sys", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    const modelTurns = prompt.match(/<start_of_turn>model/g) || [];
    expect(modelTurns.length).toBe(2); // after system + after user
  });
});

describe("cleanReply", () => {
  it("strips a trailing end-of-turn marker and whitespace", () => {
    expect(cleanReply("<end_of_turn>\n  hello ")).toBe("hello");
  });
});

describe("parseToolCall", () => {
  it("parses a plain JSON tool call", () => {
    const r = parseToolCall('{"tool":"open_app","args":{"package_name":"com.whatsapp"}}');
    expect(r).toEqual({ name: "open_app", args: { package_name: "com.whatsapp" } });
  });

  it("parses a fenced tool call", () => {
    const r = parseToolCall('```json\n{"tool":"tap","args":{"text":"Send"}}\n```');
    expect(r.name).toBe("tap");
    expect(r.args.text).toBe("Send");
  });

  it("returns null for plain text", () => {
    expect(parseToolCall("Just a normal answer.")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseToolCall('{"tool":"tap","args":{')).toBeNull();
  });
});

describe("buildToolSchema", () => {
  it("returns empty for no tools", () => {
    expect(buildToolSchema([])).toBe("");
    expect(buildToolSchema(null)).toBe("");
  });

  it("embeds tool definitions", () => {
    const schema = buildToolSchema([{ name: "tap", description: "Tap", parameters: {} }]);
    expect(schema).toContain('"tap"');
    expect(schema).toContain('{"tool":"<name>","args":{...}}');
  });
});

describe("chatLocal", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns empty when no provider is available", async () => {
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => false),
      webllmAvailable: vi.fn(async () => false),
      generateStream: vi.fn(),
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl } = await import("./localChat.js");
    const res = await cl({ userMessage: "hi" });
    expect(res.provider).toBe(PROVIDER.NONE);
    expect(res.text).toBe("");
  });

  it("uses Gemini Nano and returns its text", async () => {
    const generateStream = vi.fn(async () => "nano reply");
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => true),
      webllmAvailable: vi.fn(async () => false),
      generateStream,
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl } = await import("./localChat.js");
    const res = await cl({ userMessage: "hi", provider: PROVIDER.NANO });
    expect(res.text).toBe("nano reply");
    expect(res.provider).toBe(PROVIDER.NANO);
    expect(generateStream).toHaveBeenCalled();
  });

  it("executes tools and streams the final answer (loop)", async () => {
    let calls = 0;
    const generateStream = vi.fn(async (prompt, onChunk) => {
      calls += 1;
      if (calls === 1) {
        return '{"tool":"read_screen","args":{}}';
      }
      onChunk("final");
      return "final answer";
    });
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => true),
      webllmAvailable: vi.fn(async () => false),
      generateStream,
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl } = await import("./localChat.js");
    const toolHandler = vi.fn(async () => ({ ok: true, elements: [] }));
    const chunks = [];
    const res = await cl({
      userMessage: "read my screen",
      provider: PROVIDER.NANO,
      tools: [{ name: "read_screen", description: "Read screen", parameters: {} }],
      toolHandler,
      onChunk: (c) => chunks.push(c),
      maxRounds: 3,
    });
    expect(toolHandler).toHaveBeenCalledWith("read_screen", {});
    expect(res.text).toBe("final answer");
    expect(res.toolCalls.length).toBe(1);
    expect(chunks.join("")).toBe("final");
  });

  it("stops the loop when maxRounds is exhausted", async () => {
    const generateStream = vi.fn(async () => '{"tool":"tap","args":{"x":1,"y":2}}');
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => true),
      webllmAvailable: vi.fn(async () => false),
      generateStream,
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl } = await import("./localChat.js");
    const res = await cl({
      userMessage: "do it",
      provider: PROVIDER.NANO,
      tools: [{ name: "tap", description: "Tap", parameters: {} }],
      toolHandler: vi.fn(async () => ({ ok: true })),
      maxRounds: 2,
    });
    expect(res.toolCalls.length).toBe(2);
    expect(res.text).toBe("");
  });

  it("handles tool handler rejection gracefully", async () => {
    const generateStream = vi.fn(async () => '{"tool":"open_app","args":{"package_name":"x"}}');
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => true),
      webllmAvailable: vi.fn(async () => false),
      generateStream,
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl } = await import("./localChat.js");
    const res = await cl({
      userMessage: "open app",
      provider: PROVIDER.NANO,
      tools: [{ name: "open_app", description: "x", parameters: {} }],
      toolHandler: vi.fn(async () => {
        throw new Error("boom");
      }),
      maxRounds: 1,
    });
    expect(res.toolCalls[0].result.error).toBe("boom");
  });
});

describe("resolveProvider", () => {
  it("returns NONE when nothing is available", async () => {
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => false),
      webllmAvailable: vi.fn(async () => false),
      generateStream: vi.fn(),
      chatWebLlm: vi.fn(),
    }));
    const { resolveProvider: rp } = await import("./localChat.js");
    const p = await rp();
    expect(p).toBe(PROVIDER.NONE);
  });
});
