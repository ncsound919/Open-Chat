import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CLOUD_TOOLS,
  wikipediaSearch,
  wikipediaSummary,
  newsHeadlines,
  runCloudTool,
} from "./cloudIntegrations.js";

describe("cloudIntegrations tool schemas", () => {
  it("defines the three cloud tools", () => {
    expect(CLOUD_TOOLS.map((t) => t.name)).toEqual([
      "wikipedia_search",
      "wikipedia_summary",
      "news_headlines",
    ]);
  });
});

describe("wikipediaSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails soft when no query is given", async () => {
    const res = await wikipediaSearch({});
    expect(res.ok).toBe(false);
  });

  it("returns parsed results and sends User-Agent + origin=*", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          search: [
            {
              title: "Albert Einstein",
              snippet: "<span class=\"searchmatch\">Albert</span> Einstein",
              url: "https://en.wikipedia.org/wiki/Albert_Einstein",
            },
          ],
        },
      }),
    });
    global.fetch = fetchMock;

    const res = await wikipediaSearch({ query: "Einstein", limit: 1 });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("wikipedia");
    expect(res.results[0].title).toBe("Albert Einstein");
    expect(res.results[0].snippet).toContain("Albert");
    expect(res.results[0].url).toContain("wiki/Albert_Einstein");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("origin=*");
    expect(url).toContain("srsearch=Einstein");
    expect(init.headers["User-Agent"]).toMatch(/OpenChat/);
  });

  it("fails soft on HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const res = await wikipediaSearch({ query: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/429/);
  });
});

describe("wikipediaSummary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails soft when no title is given", async () => {
    const res = await wikipediaSummary({});
    expect(res.ok).toBe(false);
  });

  it("returns the article extract from the REST summary endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Albert Einstein", extract: "Albert Einstein was a physicist." }),
    });
    const res = await wikipediaSummary({ title: "Albert Einstein" });
    expect(res.ok).toBe(true);
    expect(res.extract).toContain("physicist");
    expect(global.fetch.mock.calls[0][0]).toContain("/api/rest_v1/page/summary/Albert_Einstein");
  });
});

describe("newsHeadlines", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses Google News RSS into headlines", async () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<rss version=\"2.0\"><channel>",
      "<item><title>Headline One</title><source>BBC</source>",
      "<link>https://example.com/1</link>",
      "<pubDate>Mon, 17 Aug 2026 10:00:00 GMT</pubDate></item>",
      "<item><title>Headline Two</title><source>CNN</source>",
      "<link>https://example.com/2</link></item>",
      "</channel></rss>",
    ].join("");
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => xml });

    const res = await newsHeadlines({ topic: "tech", count: 1 });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("google-news");
    expect(res.headlines).toHaveLength(1);
    expect(res.headlines[0].title).toBe("Headline One");
    expect(res.headlines[0].source).toBe("BBC");

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("news.google.com/rss/search");
    expect(init.headers["User-Agent"]).toMatch(/OpenChat/);
  });

  it("fails soft on HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const res = await newsHeadlines({ topic: "x" });
    expect(res.ok).toBe(false);
  });
});

describe("runCloudTool dispatch", () => {
  it("routes unknown names to a soft failure", async () => {
    const res = await runCloudTool("nope", {});
    expect(res.ok).toBe(false);
  });

  it("dispatches known names", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { search: [] } }),
    });
    const res = await runCloudTool("wikipedia_search", { query: "x" });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });
});
