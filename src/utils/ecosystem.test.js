import { describe, it, expect, vi, beforeEach } from "vitest";

describe("buildEcosystemContext", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../../ECOSYSTEM.md?raw", () => ({ default: "" }));
  });

  it("returns empty when the template has no real content", async () => {
    vi.doMock("../../ECOSYSTEM.md?raw", () => ({
      default: `# ECOSYSTEM.md
# YOUR ECOSYSTEM
## 1. Ecosystem
(Describe your ecosystem here.)
## 2. Agents
- (Agent 1 — role)
## 3. Agenda
- (Current focus)
# Criteria
- True and current
`,
    }));
    const { buildEcosystemContext } = await import("./ecosystem.js");
    expect(buildEcosystemContext()).toBe("");
  });

  it("returns the ecosystem context when real content is present", async () => {
    vi.doMock("../../ECOSYSTEM.md?raw", () => ({
      default: `# ECOSYSTEM.md
# YOUR ECOSYSTEM
## 1. Ecosystem
This is the Acme ecosystem, a fleet of agents for content marketing.
## 2. Agents
- Draymond — orchestrator
- Uplift Agent — content and growth
## 3. Agenda
- Launch the new product line this quarter.
# Criteria
- Keep it clean
`,
    }));
    const { buildEcosystemContext } = await import("./ecosystem.js");
    const ctx = buildEcosystemContext();
    expect(ctx).toContain("Acme ecosystem");
    expect(ctx).toContain("Draymond");
    expect(ctx).toContain("Launch the new product line");
  });
});
