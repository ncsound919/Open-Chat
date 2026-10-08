import { describe, expect, it } from "vitest";
import { SCENARIOS, scoreScenario, runScenarioBattery, classForScenario } from "./scenarioEval.js";

describe("scoreScenario", () => {
  it("passes a good math reply", () => {
    const s = SCENARIOS.find((x) => x.id === "math");
    const r = scoreScenario(s, { reply: "6096", toolCalls: [] });
    expect(r.ok).toBe(true);
  });

  it("fails a math reply with the wrong number", () => {
    const s = SCENARIOS.find((x) => x.id === "math");
    const r = scoreScenario(s, { reply: "5000", toolCalls: [] });
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/keyword/);
  });

  it("flags missing tool calls on a tool scenario", () => {
    const s = SCENARIOS.find((x) => x.id === "tool_web");
    const r = scoreScenario(s, { reply: "The capital of France is Paris.", toolCalls: [] });
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/expected a tool call/);
  });

  it("passes a tool scenario when the right tool fired", () => {
    const s = SCENARIOS.find((x) => x.id === "tool_web");
    const r = scoreScenario(s, { reply: "Paris, per the search.", toolCalls: [{ name: "web_search", args: { query: "capital of France" } }] });
    expect(r.ok).toBe(true);
  });

  it("flags degenerate output", () => {
    const s = SCENARIOS.find((x) => x.id === "plain");
    const r = scoreScenario(s, { reply: "geory geory geory geory geory geory", toolCalls: [] });
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/degenerate/);
  });

  it("validates strict JSON scenarios", () => {
    const s = SCENARIOS.find((x) => x.id === "json");
    expect(scoreScenario(s, { reply: '{"ok":true,"value":42}', toolCalls: [] }).ok).toBe(true);
    expect(scoreScenario(s, { reply: "not json at all", toolCalls: [] }).ok).toBe(false);
  });
});

describe("runScenarioBattery", () => {
  it("runs every scenario and tallies the summary", async () => {
    const send = async (prompt) => {
      if (prompt.includes("Search the web")) return { reply: "Paris.", toolCalls: [{ name: "web_search", args: {} }] };
      if (prompt.includes("What is 127")) return { reply: "6096", toolCalls: [] };
      if (prompt.includes("ONLY this exact JSON")) return { reply: '{"ok":true,"value":42}', toolCalls: [] };
      return { reply: "Hello!", toolCalls: [] };
    };
    const battery = await runScenarioBattery({ send });
    expect(battery.total).toBe(SCENARIOS.length);
    expect(battery.results.length).toBe(SCENARIOS.length);
    expect(typeof battery.latencyMs).toBe("number");
  });
});

describe("classForScenario", () => {
  it("classifies scenarios", () => {
    expect(classForScenario(SCENARIOS.find((x) => x.id === "tool_web"))).toBe("tool");
    expect(classForScenario(SCENARIOS.find((x) => x.id === "news"))).toBe("research");
    expect(classForScenario(SCENARIOS.find((x) => x.id === "json"))).toBe("json");
  });
});