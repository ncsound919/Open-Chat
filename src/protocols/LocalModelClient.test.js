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

import { chatLocal } from "../utils/localChat.js";
import { execPhoneTool } from "../utils/phoneTools.js";

describe("LocalModelClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("threads confirmAction into phone tool execution", async () => {
    chatLocal.mockImplementation(async ({ toolHandler }) => {
      const result = await toolHandler("tap", { text: "Send" });
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

  it("handles draymond tool names as a set (no .has() crash)", async () => {
    chatLocal.mockImplementation(async ({ toolHandler }) => {
      // DRAYMOND_TOOL_NAMES is mocked as an array; the client wraps it in a Set.
      const result = await toolHandler("list_skills", {});
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
});
