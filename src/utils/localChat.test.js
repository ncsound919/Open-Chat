import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildGemmaPrompt,
  cleanReply,
  parseToolCall,
  buildToolSchema,
  looksDegenerate,
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

  it("strips a trailing end-of-turn marker from a session reply", () => {
    expect(cleanReply("Zed.\n<end_of_turn>")).toBe("Zed.");
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
    expect(schema).toContain("tap: Tap");
    expect(schema).toContain('{"tool":"<name>","args":{...}}');
  });

  it("shows the JSON contract and examples before the tool list", () => {
    const schema = buildToolSchema([{ name: "web_search", description: "Search", parameters: { query: {} } }]);
    expect(schema.indexOf("TOOL CALLING")).toBeGreaterThan(-1);
    expect(schema.indexOf('{"tool":"<name>","args":{...}}')).toBeLessThan(schema.indexOf("web_search: Search"));
    expect(schema).toContain('{"tool":"web_search","args":{"query":');
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
    const generateStream = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return '{"tool":"read_screen","args":{}}';
      }
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
    // Only the final plain-text answer is surfaced — not the raw tool JSON.
    expect(chunks.join("")).toBe("final answer");
    expect(chunks.join("")).not.toContain('"tool"');
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

  it("uses the persistent session for MEDIAPIPE and feeds incremental turns", async () => {
    let genCalls = 0;
    const generateSession = vi.fn(async () => {
      genCalls += 1;
      if (genCalls === 1) return { text: '{"tool":"read_screen","args":{}}<end_of_turn>', ok: true };
      return { text: "final answer<end_of_turn>", ok: true };
    });
    const beginSession = vi.fn(async () => ({ ok: true }));
    const mpMock = {
      generate: vi.fn(),
      beginSession,
      generateSession,
      addListener: vi.fn(async () => ({ remove: vi.fn() })),
      cancel: vi.fn(async () => ({})),
    };
    vi.doMock("./modelRegistry.js", () => ({
      loadMediaPipe: vi.fn(async () => mpMock),
    }));
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => false),
      webllmAvailable: vi.fn(async () => false),
      generateStream: vi.fn(),
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl, PROVIDER: P } = await import("./localChat.js");
    const toolHandler = vi.fn(async () => ({ ok: true, elements: [] }));
    const res = await cl({
      userMessage: "read my screen",
      provider: P.MEDIAPIPE,
      systemPrompt: "SYSTEM PROMPT",
      tools: [{ name: "read_screen", description: "Read screen", parameters: {} }],
      toolHandler,
      maxRounds: 3,
    });
    // System seeded once, not reprocessed
    expect(beginSession).toHaveBeenCalledTimes(1);
    expect(beginSession.mock.calls[0][0].systemPrompt).toContain("SYSTEM PROMPT");
    // Two generation passes: tool call round + final answer round
    expect(generateSession).toHaveBeenCalledTimes(2);
    const firstPrompt = generateSession.mock.calls[0][0].prompt;
    const secondPrompt = generateSession.mock.calls[1][0].prompt;
    // First incremental feed is the user message; second is the tool result (not the full prompt)
    expect(firstPrompt).toContain("read my screen");
    expect(firstPrompt).not.toContain("SYSTEM PROMPT");
    expect(secondPrompt).toContain("Tool result");
    expect(res.text).toBe("final answer");
    expect(res.provider).toBe(P.MEDIAPIPE);
    expect(res.toolCalls.length).toBe(1);
    expect(toolHandler).toHaveBeenCalledWith("read_screen", {});
  });

  it("resets and falls back to the generic loop when the session overflows", async () => {
    const generateSession = vi.fn(async () => {
      throw new Error("OUT_OF_RANGE: Calculator::Process failed");
    });
    const beginSession = vi.fn(async () => ({ ok: true }));
    const resetSession = vi.fn(async () => ({ ok: true }));
    // Generic fallback uses `generate`
    const generate = vi.fn(async () => ({ text: "fallback answer", ok: true }));
    const mpMock = {
      generate,
      beginSession,
      generateSession,
      resetSession,
      addListener: vi.fn(async () => ({ remove: vi.fn() })),
      cancel: vi.fn(async () => ({})),
    };
    vi.doMock("./modelRegistry.js", () => ({
      loadMediaPipe: vi.fn(async () => mpMock),
    }));
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => false),
      webllmAvailable: vi.fn(async () => false),
      generateStream: vi.fn(),
      chatWebLlm: vi.fn(),
    }));
    const { chatLocal: cl, PROVIDER: P } = await import("./localChat.js");
    const res = await cl({ userMessage: "hi", provider: P.MEDIAPIPE, maxRounds: 2 });
    expect(beginSession).toHaveBeenCalled();
    expect(generateSession).toHaveBeenCalled();
    expect(resetSession).toHaveBeenCalled();
    expect(generate).toHaveBeenCalled(); // fell back to full-prompt loop
    expect(res.text).toBe("fallback answer");
  });

  it("falls back to the generic loop when the session API is missing", async () => {
    const generate = vi.fn(async () => ({ text: '{"tool":"tap","args":{"x":1,"y":2}}', ok: true }));
    const mpMock = {
      generate,
      addListener: vi.fn(async () => ({ remove: vi.fn() })),
      cancel: vi.fn(async () => ({})),
    };
    vi.doMock("./modelRegistry.js", () => ({
      loadMediaPipe: vi.fn(async () => mpMock),
    }));
    vi.doMock("./OnDeviceAI.js", () => ({
      isAvailable: vi.fn(async () => false),
      webllmAvailable: vi.fn(async () => false),
    }));
    const { chatLocal: cl, PROVIDER: P } = await import("./localChat.js");
    const res = await cl({
      userMessage: "tap",
      provider: P.MEDIAPIPE,
      tools: [{ name: "tap", description: "Tap", parameters: {} }],
      toolHandler: vi.fn(async () => ({ ok: true })),
      maxRounds: 1,
    });
    // Without beginSession/generateSession it uses the full-prompt `generate` path
    expect(generate).toHaveBeenCalled();
    expect(res.toolCalls.length).toBe(1);
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

describe("looksDegenerate", () => {
  it("flags repeated-token garbage (MediaPipe GPU detokenizer bugs)", () => {
    expect(looksDegenerate("geory geory geory geory geory geory")).toBe(true);
    expect(looksDegenerate("<bos><bos><bos><bos><bos><bos>")).toBe(true);
  });

  it("accepts normal short and long replies", () => {
    expect(looksDegenerate("ace")).toBe(false);
    expect(looksDegenerate("Gemma 3n is a small model.")).toBe(false);
    expect(looksDegenerate("")).toBe(false);
  });
});
