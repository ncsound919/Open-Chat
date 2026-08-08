import { describe, it, expect } from "vitest";
import { buildAgentSystemPrompt, DEFAULT_LOCAL_SYSTEM_PROMPT } from "./galaxyPlanning.js";

describe("buildAgentSystemPrompt", () => {
  it("includes base rules by default", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("private on-device assistant");
    expect(p).toContain("GALAXY AI");
    expect(p).toContain("WORKFLOW — plan before you act");
  });

  it("includes phone tool descriptions", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("read_screen");
    expect(p).toContain("galaxy_ai_action");
  });

  it("can exclude sections", () => {
    const p = buildAgentSystemPrompt({ galaxy: false, planning: false, phoneTools: false });
    expect(p).not.toContain("GALAXY AI");
    expect(p).not.toContain("WORKFLOW");
  });

  it("appends custom instructions", () => {
    const p = buildAgentSystemPrompt({ extra: "Be terse." });
    expect(p).toContain("Be terse.");
  });

  it("DEFAULT_LOCAL_SYSTEM_PROMPT is the full prompt", () => {
    expect(DEFAULT_LOCAL_SYSTEM_PROMPT).toContain("GALAXY AI");
    expect(DEFAULT_LOCAL_SYSTEM_PROMPT).toContain("WORKFLOW");
  });
});
