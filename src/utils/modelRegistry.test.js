import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mediaPipeBundleToEntry,
  formatBytes,
  detectLocalModels,
  detectMediaPipeBundles,
  autoLoadMediaPipeModel,
  MODEL_STATE,
} from "./modelRegistry.js";
import gemma from "@open-chat/mediapipe-gemma";

vi.mock("./localModels.js", () => ({
  scanLocalModels: vi.fn(async () => [
    { name: "Ollama", baseUrl: "http://127.0.0.1:11434", models: ["llama3.2"] },
  ]),
}));

vi.mock("@open-chat/mediapipe-gemma", () => ({
  default: {
    getStatus: vi.fn(async () => ({ available: true, modelLoaded: false })),
    listModels: vi.fn(async () => ({ models: [] })),
    downloadModel: vi.fn(),
    loadModel: vi.fn(),
    generate: vi.fn(),
    cancel: vi.fn(),
    unloadModel: vi.fn(),
    deleteModel: vi.fn(),
  },
}));

vi.mock("@open-chat/phone-control", () => ({
  default: {
    getStatus: vi.fn(async () => ({ enabled: false, available: true })),
    readScreen: vi.fn(async () => ({ nodes: [] })),
    performTap: vi.fn(),
    inputText: vi.fn(),
    performGlobalAction: vi.fn(),
    openApp: vi.fn(),
    swipe: vi.fn(),
    screenshot: vi.fn(),
  },
}));

describe("mediaPipeBundleToEntry", () => {
  it("normalizes a known bundle", () => {
    const entry = mediaPipeBundleToEntry({
      fileName: "gemma-3n-E4B-it-int4.task",
      sizeBytes: 1000,
      loaded: true,
      path: "/data/user/0/com.openchat.app/files/models/gemma-3n-E4B-it-int4.task",
    });
    expect(entry.id).toBe("gemma-e4b");
    expect(entry.name).toBe("Gemma 3n E4B");
    expect(entry.kind).toBe("ondevice");
    expect(entry.provider).toBe("mediapipe");
    expect(entry.loaded).toBe(true);
  });

  it("falls back for unknown bundles", () => {
    const entry = mediaPipeBundleToEntry({ fileName: "custom.task", sizeBytes: 5, loaded: false });
    expect(entry.id).toBe("custom.task");
    expect(entry.name).toBe("custom");
    expect(entry.url).toBe("");
  });
});

describe("detectMediaPipeBundles", () => {
  it("returns [] when the plugin is unavailable", async () => {
    const bundles = await detectMediaPipeBundles();
    expect(bundles).toEqual([]);
  });
});

describe("detectLocalModels", () => {
  it("includes server models when scanning", async () => {
    const { sources } = await detectLocalModels({ includeServers: true });
    const servers = sources.find((s) => s.id === "servers");
    expect(servers).toBeDefined();
    expect(servers.models[0].name).toBe("llama3.2");
    expect(servers.models[0].kind).toBe("server");
  });
});

describe("autoLoadMediaPipeModel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no bundle exists", async () => {
    gemma.getStatus.mockResolvedValue({ modelLoaded: false });
    gemma.listModels.mockResolvedValue({ models: [] });
    expect(await autoLoadMediaPipeModel()).toBeNull();
  });

  it("returns the loaded path when a model is already loaded", async () => {
    gemma.getStatus.mockResolvedValue({ modelLoaded: true, modelPath: "/m/gemma.task" });
    expect(await autoLoadMediaPipeModel()).toBe("/m/gemma.task");
    expect(gemma.loadModel).not.toHaveBeenCalled();
  });

  it("loads the first bundle when none is loaded", async () => {
    gemma.getStatus.mockResolvedValue({ modelLoaded: false });
    gemma.listModels.mockResolvedValue({ models: [{ fileName: "gemma.task" }] });
    gemma.loadModel.mockResolvedValue({ ok: true, modelPath: "/m/loaded" });
    expect(await autoLoadMediaPipeModel()).toBe("/m/loaded");
    expect(gemma.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "gemma.task", backend: "auto" })
    );
  });

  it("returns null when loadModel fails", async () => {
    gemma.getStatus.mockResolvedValue({ modelLoaded: false });
    gemma.listModels.mockResolvedValue({ models: [{ fileName: "gemma.task" }] });
    gemma.loadModel.mockResolvedValue({ ok: false });
    expect(await autoLoadMediaPipeModel()).toBeNull();
  });

  it("returns null when listModels throws", async () => {
    gemma.getStatus.mockResolvedValue({ modelLoaded: false });
    gemma.listModels.mockRejectedValue(new Error("boom"));
    expect(await autoLoadMediaPipeModel()).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats units", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(4405655031)).toMatch(/GB/);
  });
});

describe("MODEL_STATE", () => {
  it("has stable states", () => {
    expect(MODEL_STATE.LOADED).toBe("loaded");
    expect(MODEL_STATE.DOWNLOADING).toBe("downloading");
  });
});
