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

vi.mock("../utils/researchTools.js", () => ({
  READ_PAGE_TOOL: { name: "read_page", description: "d", parameters: {} },
  DEEP_RESEARCH_TOOL: { name: "deep_research", description: "d", parameters: {} },
  deepResearch: vi.fn(async () => ({ ok: false })),
  execResearchTool: vi.fn(async () => ({ ok: true })),
  isResearchTool: vi.fn((name) => ["read_page", "deep_research"].includes(name)),
}));

vi.mock("../utils/browserNavigate.js", () => ({
  NAVIGATE_TOOL: { name: "navigate", description: "d", parameters: {} },
  navigateTo: vi.fn(async () => ({ ok: false })),
}));

vi.mock("../utils/researchIntent.js", () => ({
  detectResearchIntent: vi.fn((t) =>
    /\bresearch\b/i.test(String(t)) ? { research: true, query: t } : null
  ),
  buildGroundingSection: vi.fn(
    (dr) => `GROUNDING[${dr.sourcesUsed.join(",")}]`
  ),
  RESEARCH_FAILED_SECTION: "RESEARCH_FAILED",
}));

import { chatLocal } from "../utils/localChat.js";
import { execPhoneTool } from "../utils/phoneTools.js";
import { resolveProvider } from "../utils/localChat.js";
import { autoLoadMediaPipeModel } from "../utils/modelRegistry.js";
import { runCloudTool } from "../utils/cloudIntegrations.js";
import { runRecipe } from "../utils/appRecipes.js";
import { deepResearch } from "../utils/researchTools.js";
import { detectResearchIntent } from "../utils/researchIntent.js";

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

  it("registers cloud + recipe tools only when opted in, and routes them", async () => {
    let capturedTools = [];
    chatLocal.mockImplementation(async ({ tools, toolHandler }) => {
      capturedTools = tools;
      await toolHandler("wikipedia_search", { query: "x" });
      await toolHandler("gmail_inbox", {});
      return { text: "done", toolCalls: [], usedTools: [] };
    });

    const confirm = vi.fn(async () => true);
    const client = new LocalModelClient(
      {
        id: "local",
        model: "auto",
        phoneToolsEnabled: true,
        galaxySkillsEnabled: false,
        cloudToolsEnabled: true,
        recipesEnabled: true,
      },
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

  it("keeps the default tool surface small (core research + phone only)", async () => {
    let capturedTools = [];
    chatLocal.mockImplementation(async ({ tools }) => {
      capturedTools = tools;
      return { text: "done", toolCalls: [], usedTools: [] };
    });

    const client = new LocalModelClient({
      id: "local",
      model: "auto",
      phoneToolsEnabled: true,
      galaxySkillsEnabled: false,
    });
    await client.send("hello there friend", () => {});

    const names = capturedTools.map((t) => t.name);
    // Core research set present…
    for (const n of ["web_search", "navigate", "read_page", "deep_research"]) {
      expect(names).toContain(n);
    }
    // …opt-in packs absent.
    expect(names).not.toContain("image_gen");
    expect(names).not.toContain("wikipedia_search");
    expect(names).not.toContain("gmail_inbox");
    expect(capturedTools.length).toBeLessThanOrEqual(12);
  });

  it("auto-runs research on research-style messages and grounds the prompt", async () => {
    deepResearch.mockResolvedValueOnce({
      ok: true,
      summary: "DIGEST: gemma runs on phone",
      sourcesUsed: ["wikipedia", "duckduckgo"],
      findingsCount: 4,
    });
    let capturedPrompt = "";
    chatLocal.mockImplementation(async ({ systemPrompt }) => {
      capturedPrompt = systemPrompt;
      return { text: "grounded answer", toolCalls: [], usedTools: [] };
    });

    const client = new LocalModelClient({
      id: "local",
      model: "auto",
      phoneToolsEnabled: true,
    });
    const out = await client.send("research gemma 3n for me", () => {});

    expect(detectResearchIntent).toHaveBeenCalled();
    expect(deepResearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringMatching(/gemma 3n/i) })
    );
    expect(capturedPrompt).toContain("GROUNDING[wikipedia,duckduckgo]");
    expect(out).toBe("grounded answer");
  });

  it("injects a hard failure notice when auto-research finds nothing", async () => {
    deepResearch.mockResolvedValueOnce({ ok: false });
    let capturedPrompt = "";
    chatLocal.mockImplementation(async ({ systemPrompt }) => {
      capturedPrompt = systemPrompt;
      return { text: "cannot verify", toolCalls: [], usedTools: [] };
    });

    const client = new LocalModelClient({ id: "local", model: "auto" });
    await client.send("research the latest on x", () => {});
    expect(capturedPrompt).toContain("RESEARCH_FAILED");
  });

  it("skips auto-research when disabled or message is not research", async () => {
    deepResearch.mockClear();
    detectResearchIntent.mockClear();
    chatLocal.mockImplementation(async () => ({ text: "ok", toolCalls: [], usedTools: [] }));

    const off = new LocalModelClient({
      id: "local",
      model: "auto",
      phoneToolsEnabled: true,
      autoResearchEnabled: false,
    });
    await off.send("research something", () => {});
    expect(deepResearch).not.toHaveBeenCalled();

    const on = new LocalModelClient({
      id: "local",
      model: "auto",
      phoneToolsEnabled: true,
    });
    await on.send("what time is my meeting", () => {});
    expect(deepResearch).not.toHaveBeenCalled();
  });
});
