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
      const r = detectResearchIntent(t);
      expect(r).not.toBeNull();
      expect(r.kind).toBe("fresh");
    }
  });

  it("fires on current-events phrasing with kind=fresh", () => {
    const r1 = detectResearchIntent("what is the price of bitcoin right now");
    expect(r1).not.toBeNull();
    expect(r1.kind).toBe("fresh");
    const r2 = detectResearchIntent("what happened in ukraine today");
    expect(r2).not.toBeNull();
    expect(r2.kind).toBe("fresh");
  });

  it("fires on factual questions with kind=stable", () => {
    const r1 = detectResearchIntent("who invented the transistor radio");
    expect(r1).not.toBeNull();
    expect(r1.kind).toBe("stable");
    const r2 = detectResearchIntent("what is the history of the ottoman empire");
    expect(r2).not.toBeNull();
    expect(r2.kind).toBe("stable");
  });

  it("classifies additional factual triggers as kind=stable", () => {
    for (const t of [
      "what caused ww2",
      "definition of entropy",
      "meaning of life",
      "who discovered penicillin",
    ]) {
      const r = detectResearchIntent(t);
      expect(r).not.toBeNull();
      expect(r.kind).toBe("stable");
    }
  });

  it("classifies time-sensitive phrasings as kind=fresh or news", () => {
    for (const [t, kind] of [
      ["what is happening right now", "fresh"],
      ["updates on the merger", "fresh"],
      ["weather in tokyo today", "fresh"],
      ["stock price of apple", "fresh"],
      ["breaking news about the merger", "news"],
      ["latest headlines from reuters", "news"],
    ]) {
      const r = detectResearchIntent(t);
      expect(r).not.toBeNull();
      expect(r.kind).toBe(kind, `expected "${t}" → kind=${kind}, got kind=${r?.kind}`);
    }
  });

  it("classifies news source names as kind=news", () => {
    for (const [t, kind] of [
      ["bbc coverage of ukraine", "news"],
      ["reuters latest on the fed", "news"],
      ["ap news about elon musk", "news"],
      ["npr headlines about the election", "news"],
      ["what is happening in ukraine", "news"],
      ["hacker news about llm reasoning", "news"],
      ["headlines about the silicon valley layoffs", "news"],
      ["the guardian on housing crisis", "news"],
    ]) {
      const r = detectResearchIntent(t);
      expect(r).not.toBeNull();
      expect(r.kind).toBe(kind, `expected "${t}" → kind=${kind}, got kind=${r?.kind}`);
    }
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
