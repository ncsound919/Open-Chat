import { describe, it, expect, vi } from "vitest";
import {
  READ_PAGE_TOOL,
  DEEP_RESEARCH_TOOL,
  isResearchTool,
  readPageContext,
  deepResearch,
  execResearchTool,
  queryTerms,
} from "./researchTools.js";

vi.mock("./modelRegistry.js", () => ({
  loadPhoneControl: vi.fn(async () => null),
}));

vi.mock("./webSearch.js", () => ({
  webSearch: vi.fn(async ({ query }) => ({
    ok: true,
    provider: "chrome",
    results: [`live result for ${query}`],
  })),
}));

function screenPlugin(nodes, foregroundPackage = "com.android.chrome") {
  return {
    readScreen: vi.fn(async () => ({ foregroundPackage, nodes })),
  };
}

describe("isResearchTool", () => {
  it("recognizes research pack tools", () => {
    expect(isResearchTool("read_page")).toBe(true);
    expect(isResearchTool("deep_research")).toBe(true);
    expect(isResearchTool("tap")).toBe(false);
  });
});

describe("tool schemas", () => {
  it("exposes read_page and deep_research", () => {
    expect(READ_PAGE_TOOL.name).toBe("read_page");
    expect(DEEP_RESEARCH_TOOL.name).toBe("deep_research");
    expect(DEEP_RESEARCH_TOOL.parameters.query).toBeDefined();
  });
});

describe("readPageContext", () => {
  it("extracts URL, title, and page text from Chrome's tree", async () => {
    const phone = screenPlugin([
      { text: "https://en.wikipedia.org/wiki/Key_wire", viewId: "com.android.chrome:id/url_bar", editable: true, x: 0, y: 60, w: 900, h: 60 },
      { text: "Key wire - Wikipedia", x: 0, y: 130, w: 900, h: 50 },
      { text: "A key wire is a wire used as a key.", x: 0, y: 300, w: 900, h: 40 },
      { text: "History section", clickable: true, x: 0, y: 400, w: 200, h: 40 },
      { text: "A key wire is a wire used as a key.", x: 0, y: 500, w: 900, h: 40 },
    ]);
    const res = await readPageContext({ phoneControl: phone });
    expect(res.ok).toBe(true);
    expect(res.url).toBe("https://en.wikipedia.org/wiki/Key_wire");
    expect(res.title).toContain("Key wire");
    expect(res.text).toContain("A key wire is a wire used as a key.");
    // duplicate lines are deduped
    expect(res.text.match(/A key wire is a wire/g)?.length).toBe(1);
  });

  it("upgrades bare domains to https", async () => {
    const phone = screenPlugin([
      { text: "example.com/page", viewId: "url_bar", editable: true, x: 0, y: 0, w: 100, h: 40 },
    ]);
    const res = await readPageContext({ phoneControl: phone });
    expect(res.url).toBe("https://example.com/page");
  });

  it("fails gracefully without the plugin", async () => {
    const res = await readPageContext({});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unavailable/i);
  });

  it("reports empty screens", async () => {
    const phone = screenPlugin([]);
    const res = await readPageContext({ phoneControl: phone });
    expect(res.ok).toBe(false);
  });
});

describe("queryTerms", () => {
  it("drops stopwords and short tokens", () => {
    expect(queryTerms("What is the history of quantum computing?")).toEqual([
      "history",
      "quantum",
      "computing",
    ]);
  });
});

describe("deepResearch", () => {
  it("requires a query", async () => {
    expect((await deepResearch({})).ok).toBe(false);
  });

  it("aggregates and ranks findings across mocked sources with attribution", async () => {
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("opensearch")) {
        return { ok: true, json: async () => ["quantum computing", ["Quantum computing"], ["", "", "", ""], []] };
      }
      if (u.includes("/api/rest_v1/page/summary/")) {
        return {
          ok: true,
          json: async () => ({
            title: "Quantum computing",
            extract: "Quantum computing exploits quantum mechanics. It uses qubits instead of bits. Quantum computers may speed up factoring.",
            content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quantum_computing" } },
          }),
        };
      }
      if (u.includes("list=search")) {
        return {
          ok: true,
          json: async () => ({
            query: { search: [{ title: "Qubit", snippet: "A <b>qubit</b> is the basic unit of quantum information." }] },
          }),
        };
      }
      if (u.includes("duckduckgo")) {
        return {
          ok: true,
          json: async () => ({
            Heading: "quantum computing",
            AbstractText: "Quantum computing is the study of quantum computers.",
            RelatedTopics: [{ Text: "Related: quantum algorithms" }],
          }),
        };
      }
      throw new Error("unexpected url " + u);
    });

    const res = await deepResearch({
      query: "quantum computing",
      liveWeb: false,
    });

    expect(res.ok).toBe(true);
    expect(res.summary).toContain("RESEARCH DIGEST: quantum computing");
    expect(res.sourcesUsed.length).toBeGreaterThanOrEqual(3);
    expect(res.sourcesUsed).toContain("wikipedia");
    expect(res.sourcesUsed).toContain("wikipedia-search");
    expect(res.sourcesUsed).toContain("duckduckgo");
    expect(res.findingsCount).toBeGreaterThan(0);
  });

  it("degrades to ok:false when every source fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await deepResearch({ query: "anything", liveWeb: false });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sources failed/i);
  });

  it("includes the live Chrome leg when webSearch succeeds", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await deepResearch({
      query: "fleet status",
      liveWeb: true,
      phoneControl: {},
    });
    // All cloud sources failed; the chrome-live leg rescues the run.
    expect(res.ok).toBe(true);
    expect(res.sourcesUsed.some((s) => s.startsWith("chrome-live"))).toBe(true);
  });
});

describe("execResearchTool", () => {
  it("routes read_page", async () => {
    const phone = screenPlugin([
      { text: "https://x.test", viewId: "url_bar", editable: true, x: 0, y: 0, w: 10, h: 10 },
    ]);
    const res = await execResearchTool("read_page", {}, { phoneControl: phone });
    expect(res.ok).toBe(true);
    expect(res.url).toBe("https://x.test");
  });

  it("errors on unknown tools", async () => {
    expect((await execResearchTool("nope", {})).ok).toBe(false);
  });
});
