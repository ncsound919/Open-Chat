import { describe, it, expect, vi, afterEach } from "vitest";
import { buildInsightPrompt } from "./OnDeviceAI.js";

// OnDeviceAI caches its availability result in a module-level variable, so we
// re-import the module after resetModules to get a fresh cache per scenario.
async function loadOnDeviceAI() {
  vi.resetModules();
  return await import("./OnDeviceAI.js");
}

function stubSession({ promptResult = "hello", streamChunks = null } = {}) {
  const destroy = vi.fn();
  const session = { destroy };
  if (streamChunks) {
    session.promptStreaming = vi.fn(async function* () {
      for (const chunk of streamChunks) yield chunk;
    });
    session.prompt = vi.fn();
  } else {
    session.prompt = vi.fn().mockResolvedValue(promptResult);
  }
  return session;
}

function stubAi({ available = "readily", session } = {}) {
  window.ai = {
    languageModel: {
      capabilities: vi.fn(async () => ({ available })),
      create: vi.fn().mockResolvedValue(session),
    },
  };
}

afterEach(() => {
  delete window.ai;
});

describe("OnDeviceAI checkAvailability", () => {
  it("returns 'no' when window.ai is missing", async () => {
    const mod = await loadOnDeviceAI();
    await expect(mod.checkAvailability()).resolves.toBe("no");
  });

  it("returns 'no' when the Prompt API is missing capabilities", async () => {
    window.ai = {};
    const mod = await loadOnDeviceAI();
    await expect(mod.checkAvailability()).resolves.toBe("no");
  });

  it("returns 'yes' when the model is readily available", async () => {
    stubAi({ available: "readily" });
    const mod = await loadOnDeviceAI();
    await expect(mod.checkAvailability()).resolves.toBe("yes");
  });

  it("returns 'after-download' when the model needs downloading", async () => {
    stubAi({ available: "after-download" });
    const mod = await loadOnDeviceAI();
    await expect(mod.checkAvailability()).resolves.toBe("after-download");
  });

  it("returns 'no' for any other availability status", async () => {
    stubAi({ available: "unavailable" });
    const mod = await loadOnDeviceAI();
    await expect(mod.checkAvailability()).resolves.toBe("no");
  });

  it("returns 'no' when the capabilities() call throws", async () => {
    window.ai = {
      languageModel: {
        capabilities: vi.fn(async () => {
          throw new Error("not supported");
        }),
      },
    };
    const mod = await loadOnDeviceAI();
    await expect(mod.checkAvailability()).resolves.toBe("no");
  });

  it("caches the result after the first check", async () => {
    stubAi({ available: "readily" });
    const mod = await loadOnDeviceAI();
    await mod.checkAvailability();
    await mod.checkAvailability();
    expect(window.ai.languageModel.capabilities).toHaveBeenCalledTimes(1);
  });
});

describe("OnDeviceAI isAvailable", () => {
  it("is true for 'readily'", async () => {
    stubAi({ available: "readily" });
    const mod = await loadOnDeviceAI();
    await expect(mod.isAvailable()).resolves.toBe(true);
  });

  it("is true for 'after-download'", async () => {
    stubAi({ available: "after-download" });
    const mod = await loadOnDeviceAI();
    await expect(mod.isAvailable()).resolves.toBe(true);
  });

  it("is false when unavailable", async () => {
    stubAi({ available: "unavailable" });
    const mod = await loadOnDeviceAI();
    await expect(mod.isAvailable()).resolves.toBe(false);
  });
});

describe("OnDeviceAI generate", () => {
  it("throws when the API is unavailable", async () => {
    stubAi({ available: "no" });
    const mod = await loadOnDeviceAI();
    await expect(mod.generate("hello")).rejects.toThrow(
      "On-device AI is not available on this device/browser."
    );
  });

  it("returns the session prompt result and destroys the session", async () => {
    const session = stubSession({ promptResult: "generated text" });
    stubAi({ session });
    const mod = await loadOnDeviceAI();
    await expect(mod.generate("hi")).resolves.toBe("generated text");
    expect(session.prompt).toHaveBeenCalledWith("hi", undefined);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards systemPrompt/temperature/topK/signal to the model", async () => {
    const session = stubSession();
    stubAi({ session });
    const signal = {};
    const mod = await loadOnDeviceAI();
    await mod.generate("hi", {
      systemPrompt: "be terse",
      temperature: 0.5,
      topK: 3,
      signal,
    });
    expect(window.ai.languageModel.create).toHaveBeenCalledWith({
      systemPrompt: "be terse",
      temperature: 0.5,
      topK: 3,
    });
    expect(session.prompt).toHaveBeenCalledWith("hi", { signal });
  });

  it("passes an empty options object when no options are given", async () => {
    const session = stubSession();
    stubAi({ session });
    const mod = await loadOnDeviceAI();
    await mod.generate("hi");
    expect(window.ai.languageModel.create).toHaveBeenCalledWith({});
  });

  it("throws a friendly error when create() fails", async () => {
    window.ai = {
      languageModel: {
        capabilities: vi.fn(async () => ({ available: "readily" })),
        create: vi.fn(async () => {
          throw new Error("model download failed");
        }),
      },
    };
    const mod = await loadOnDeviceAI();
    await expect(mod.generate("hi")).rejects.toThrow(
      "Failed to create on-device AI session: model download failed"
    );
  });

  it("destroys the session even when prompt() rejects", async () => {
    const session = stubSession();
    session.prompt = vi.fn(async () => {
      throw new Error("generation failed");
    });
    stubAi({ session });
    const mod = await loadOnDeviceAI();
    await expect(mod.generate("hi")).rejects.toThrow("generation failed");
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("OnDeviceAI generateStream", () => {
  it("yields only the incremental chunks and resolves with full text", async () => {
    const session = stubSession({ streamChunks: ["Hel", "Hello", "Hello, world!"] });
    stubAi({ session });
    const onChunk = vi.fn();
    const mod = await loadOnDeviceAI();
    await expect(mod.generateStream("hi", onChunk)).resolves.toBe(
      "Hello, world!"
    );
    expect(onChunk).toHaveBeenNthCalledWith(1, "Hel");
    expect(onChunk).toHaveBeenNthCalledWith(2, "lo");
    expect(onChunk).toHaveBeenNthCalledWith(3, ", world!");
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws when the API is unavailable", async () => {
    stubAi({ available: "no" });
    const mod = await loadOnDeviceAI();
    await expect(mod.generateStream("hi", vi.fn())).rejects.toThrow(
      "On-device AI is not available on this device/browser."
    );
  });

  it("throws a friendly error when create() fails", async () => {
    window.ai = {
      languageModel: {
        capabilities: vi.fn(async () => ({ available: "readily" })),
        create: vi.fn(async () => {
          throw new Error("no model");
        }),
      },
    };
    const mod = await loadOnDeviceAI();
    await expect(mod.generateStream("hi", vi.fn())).rejects.toThrow(
      "Failed to create on-device AI session: no model"
    );
  });
});

describe("OnDeviceAI buildInsightPrompt", () => {
  it("weaves the task, response, and instructions into the prompt", () => {
    const result = buildInsightPrompt("The orchestrator reply.", "Build a plan");
    expect(result).toContain("Build a plan");
    expect(result).toContain("The orchestrator reply.");
    expect(result).toContain("ORCHESTRATOR RESPONSE:");
    expect(result).toContain("short bullet points starting with");
  });
});
