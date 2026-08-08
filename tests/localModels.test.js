import { describe, expect, it, vi, afterEach } from "vitest";
import { scanLocalModels, modelServerToBot, fetchModels } from "../src/utils/localModels.js";

function mockFetch(url, status = 200, body) {
  global.fetch = vi.fn(async (input) => {
    if (String(input).includes("/v1/models")) {
      return {
        ok: status === 200,
        status,
        json: async () => body,
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchModels", () => {
  it("parses OpenAI-style model lists", async () => {
    mockFetch("http://127.0.0.1:11434/v1/models", 200, {
      data: [{ id: "llama3" }, { id: "mistral" }],
    });
    const models = await fetchModels("http://127.0.0.1:11434");
    expect(models).toEqual(["llama3", "mistral"]);
  });

  it("parses plain string model lists", async () => {
    mockFetch("http://127.0.0.1:11434/v1/models", 200, {
      models: ["phi3", "gemma"],
    });
    const models = await fetchModels("http://127.0.0.1:11434");
    expect(models).toEqual(["phi3", "gemma"]);
  });

  it("returns [] on non-OK responses", async () => {
    mockFetch("http://127.0.0.1:11434/v1/models", 500, {});
    const models = await fetchModels("http://127.0.0.1:11434");
    expect(models).toEqual([]);
  });
});

describe("scanLocalModels", () => {
  it("discovers servers that respond with models", async () => {
    mockFetch("http://127.0.0.1:11434/v1/models", 200, { data: [{ id: "llama3" }] });
    const results = await scanLocalModels();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].models).toContain("llama3");
  });
});

describe("modelServerToBot", () => {
  it("builds a hermes bot pointing at the local server", () => {
    const bot = modelServerToBot(
      { name: "Ollama", baseUrl: "http://127.0.0.1:11434", models: ["llama3"] },
      "llama3"
    );
    expect(bot.protocol).toBe("hermes");
    expect(bot.host).toBe("127.0.0.1");
    expect(bot.port).toBe(11434);
    expect(bot.model).toBe("llama3");
    expect(bot.localModel).toBe(true);
  });
});
