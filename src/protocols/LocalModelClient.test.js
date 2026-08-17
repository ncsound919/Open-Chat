import { describe, it, expect, vi } from "vitest";
import { LocalModelClient } from "./LocalModelClient.js";

vi.mock("../utils/localChat.js", () => ({
  chatLocal: vi.fn(),
  resolveProvider: vi.fn(async () => "nano"),
  PROVIDER: { NANO: "nano", MEDIAPIPE: "mediapipe", WEBLLM: "webllm", NONE: "none" },
}));

vi.mock("../utils/phoneTools.js", () => ({
  PHONE_TOOLS: [],
  execPhoneTool: vi.fn(async (name, args, opts) => {
    // Call the injected confirm gate to exercise the wiring.
    if (typeof opts?.confirm === "function") {
      await opts.confirm({ name, args, description: `run ${name}` });
    }
    return { ok: true };
  }),
}));

vi.mock("../utils/galaxyAi.js", () => ({
  GALAXY_AI_SKILLS: [],
  execGalaxySkill: vi.fn(async (name, args, opts) => {
    if (typeof opts?.confirm === "function") {
      await opts.confirm({ name, args, description: `run ${name}` });
    }
    return { ok: true };
  }),
}));

vi.mock("../utils/galaxyPlanning.js", () => ({
  DEFAULT_LOCAL_SYSTEM_PROMPT: "system",
}));

vi.mock("../utils/verification.js", () => ({ verifyOutput: vi.fn() }));

vi.mock("../utils/appRegistry.js", () => ({
  discoverApps: vi.fn(async () => ({ apps: [] })),
  buildAppContext: vi.fn(() => ""),
}));

vi.mock("../utils/draymondTools.js", () => ({
  DRAYMOND_TOOL_NAMES: ["list_skills"],
}));

vi.mock("../utils/cloudIntegrations.js", () => ({
  CLOUD_TOOLS: [{ name: "wikipedia_search", description: "d", parameters: {} }],
  CLOUD_TOOL_NAMES: new Set(["wikipedia_search"]),
  runCloudTool: vi.fn(async (name) => ({ ok: true, name })),
}));

vi.mock("../utils/appRecipes.js", () => ({
  RECIPE_TOOLS: [{ name: "gmail_inbox", description: "d", parameters: {} }],
  RECIPE_NAMES: new Set(["gmail_inbox"]),
  runRecipe: vi.fn(async (name) => ({ ok: true, name })),
}));

vi.mock("../utils/modelRegistry.js", () => ({
  autoLoadMediaPipeModel: vi.fn(async () => null),
}));

import { chatLocal } from "../utils/localChat.js";
import { execPhoneTool } from "../utils/phoneTools.js";
import { resolveProvider } from "../utils/localChat.js";
import { autoLoadMediaPipeModel } from "../utils/modelRegistry.js";
import { runCloudTool } from "../utils/cloudIntegrations.js";
import { runRecipe } from "../utils/appRecipes.js";

describe("LocalModelClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("threads confirmAction into phone tool execution", async () => {
    chatLocal.mockImplementation(async ({ toolHandler }) => {
      await toolHandler("tap", { text: "Send" });
      return { text: "done", toolCalls: [], usedTools: [] };
    });

    const confirm = vi.fn(async () => true);
    const client = new LocalModelClient(
      { id: "local", model: "auto", phoneToolsEnabled: true, galaxySkillsEnabled: false },
      { confirmAction: confirm }
    );

    const out = await client.send("tap the send button", () => {});
    expect(out).toBe("done");
    expect(execPhoneTool).toHaveBeenCalledWith(
      "tap",
      { text: "Send" },
      expect.objectContaining({ confirm })
    );
  });

  it("auto-loads a mediapipe model and connects when no provider is ready", async () => {
    resolveProvider.mockResolvedValueOnce("none").mockResolvedValueOnce("mediapipe");
    autoLoadMediaPipeModel.mockResolvedValue("/m/loaded");

    const statuses = [];
    const client = new LocalModelClient({ id: "local", model: "auto" });
    client.onStatusChange = (s) => statuses.push(s);

    const status = await client.connect();
    expect(autoLoadMediaPipeModel).toHaveBeenCalled();
    expect(status).toBe("connected");
    expect(statuses).toEqual(["connected"]);
  });

  it("stays no-model when auto-load finds nothing", async () => {
    resolveProvider.mockResolvedValue("none");
    autoLoadMediaPipeModel.mockResolvedValue(null);

    const client = new LocalModelClient({ id: "local", model: "auto" });
    const status = await client.connect();
    expect(status).toBe("no-model");
  });

  it("handles draymond tool names as a set (no .has() crash)", async () => {
    chatLocal.mockImplementation(async ({ toolHandler }) => {
      // DRAYMOND_TOOL_NAMES is mocked as an array; the client wraps it in a Set.
      await toolHandler("list_skills", {});
      return { text: "skills", toolCalls: [], usedTools: [] };
    });

    const draymondHandler = vi.fn(async () => ({ ok: true }));
    const client = new LocalModelClient(
      { id: "local", model: "auto", phoneToolsEnabled: true, galaxySkillsEnabled: false },
      { draymondToolHandler: draymondHandler }
    );

    const out = await client.send("list your skills", () => {});
    expect(out).toBe("skills");
    expect(draymondHandler).toHaveBeenCalledWith("list_skills", {});
  });

  it("registers cloud + recipe tools and routes them", async () => {
    let capturedTools = [];
    chatLocal.mockImplementation(async ({ tools, toolHandler }) => {
      capturedTools = tools;
      await toolHandler("wikipedia_search", { query: "x" });
      await toolHandler("gmail_inbox", {});
      return { text: "done", toolCalls: [], usedTools: [] };
    });

    const confirm = vi.fn(async () => true);
    const client = new LocalModelClient(
      { id: "local", model: "auto", phoneToolsEnabled: true, galaxySkillsEnabled: false },
      { confirmAction: confirm }
    );

    await client.send("research and check my inbox", () => {});

    expect(capturedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "wikipedia_search" }),
        expect.objectContaining({ name: "gmail_inbox" }),
      ])
    );
    expect(runCloudTool).toHaveBeenCalledWith("wikipedia_search", { query: "x" });
    expect(runRecipe).toHaveBeenCalledWith("gmail_inbox", {}, expect.objectContaining({ confirm }));
  });
});
