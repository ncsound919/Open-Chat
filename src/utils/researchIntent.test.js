import { describe, it, expect } from "vitest";
import {
  detectResearchIntent,
  buildGroundingSection,
  RESEARCH_FAILED_SECTION,
} from "./researchIntent.js";

describe("detectResearchIntent", () => {
  it("fires on explicit research verbs", () => {
    for (const t of [
      "research gemma 3n",
      "look up quantum computing",
      "search the web for fleet status",
      "google the latest on deepseek",
      "fact check this claim",
    ]) {
      expect(detectResearchIntent(t)).not.toBeNull();
    }
  });

  it("fires on current-events phrasing", () => {
    expect(detectResearchIntent("what is the price of bitcoin right now")).not.toBeNull();
    expect(detectResearchIntent("any breaking news about the merger")).not.toBeNull();
  });

  it("fires on factual questions with enough substance", () => {
    expect(detectResearchIntent("who invented the transistor radio")).not.toBeNull();
    expect(detectResearchIntent("what is the history of the ottoman empire")).not.toBeNull();
  });

  it("does NOT fire on chat, commands, or device control", () => {
    for (const t of [
      "hey how are you",
      "tap the send button",
      "open youtube and play lofi",
      "what time is my meeting",
      "list your skills",
      "",
      "ok",
    ]) {
      expect(detectResearchIntent(t)).toBeNull();
    }
  });

  it("rejects very short inputs even with keywords", () => {
    expect(detectResearchIntent("research")).toBeNull();
  });
});

describe("buildGroundingSection", () => {
  it("embeds summary, sources, and anti-hallucination instructions", () => {
    const s = buildGroundingSection({
      summary: "DIGEST CONTENT",
      sourcesUsed: ["wikipedia", "chrome-live (chrome)"],
    });
    expect(s).toContain("VERIFIED RESEARCH FINDINGS");
    expect(s).toContain("wikipedia, chrome-live (chrome)");
    expect(s).toContain("DIGEST CONTENT");
    expect(s).toMatch(/ONLY/i);
    expect(s).toMatch(/do NOT add facts from memory/i);
  });

  it("handles a missing sources list", () => {
    const s = buildGroundingSection({ summary: "X" });
    expect(s).toContain("verified APIs");
  });

  it("failure section forbids answering from memory", () => {
    expect(RESEARCH_FAILED_SECTION).toMatch(/do NOT answer .* from memory/i);
  });
});
