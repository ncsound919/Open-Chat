/**
 * researchTools — page awareness + multi-source deep research for the
 * on-device agent.
 *
 * The local model can drive Chrome through the accessibility bridge but has
 * no vision, so it cannot tell WHICH page it is looking at. `read_page`
 * gives it that context deterministically: the omnibox URL, the tab title,
 * and the readable text of the page, extracted straight from the
 * accessibility tree (no screenshots needed).
 *
 * `deep_research` is a deterministic research orchestrator: it fans the query
 * out across many sources (Wikipedia search + article summaries, DuckDuckGo
 * instant answers + related topics, live Chrome search when accessibility is
 * available), scores and dedupes the evidence against the query terms, and
 * returns an attributed findings digest sized to fit the model's window.
 * Gemma plans; this layer does the heavy lifting.
 */

import { webSearch } from "./webSearch.js";
import { READ_PAGE_TOOL, readPageContext } from "./pageContext.js";

// Page-awareness tooling lives in pageContext.js; re-exported so existing
// consumers (and the read_page tool schema) keep a single import surface.
export { READ_PAGE_TOOL, readPageContext };

/** Tool schema: multi-source deep research. */
export const DEEP_RESEARCH_TOOL = {
  name: "deep_research",
  description:
    "Research a topic across MANY sources at once (Wikipedia articles, search snippets, DuckDuckGo, news, plus a live Chrome search). Returns an organized digest with per-source findings. Use for any question that needs more than a quick lookup.",
  parameters: {
    query: { type: "string", description: "The research question or topic" },
    max_sources: {
      type: "number",
      description: "Approximate maximum number of sources to consult (default 6)",
    },
  },
};

const RESEARCH_TOOL_NAMES = new Set([READ_PAGE_TOOL.name, DEEP_RESEARCH_TOOL.name]);

/** True if the tool belongs to the research pack. */
export function isResearchTool(name) {
  return RESEARCH_TOOL_NAMES.has(name);
}

// ── deep_research ────────────────────────────────────────────────────────

async function fetchJson(url, timeoutMs = 6000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Wikipedia full-text search → snippet results. */
async function wikiSearch(query, limit) {
  const enc = encodeURIComponent(query);
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc}&srlimit=${limit}&format=json&origin=*`
  );
  return (data?.query?.search ?? []).map((r) => ({
    source: "wikipedia-search",
    title: r.title,
    text: String(r.snippet || "").replace(/<[^>]+>/g, ""),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
  }));
}

/** Wikipedia REST summaries for the given titles. */
async function wikiSummaries(titles) {
  const out = [];
  for (const t of titles.filter(Boolean).slice(0, 5)) {
    const data = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`
    );
    if (data?.extract) {
      out.push({
        source: "wikipedia",
        title: data.title || t,
        text: data.extract,
        url: data?.content_urls?.desktop?.page || "",
      });
    }
  }
  return out;
}

/** Wikipedia opensearch to discover related article titles for the query. */
async function wikiTitles(query, limit = 5) {
  const enc = encodeURIComponent(query);
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc}&limit=${limit}&format=json&origin=*`
  );
  return Array.isArray(data?.[1]) ? data[1] : [];
}

/** DuckDuckGo instant answer + related topics. */
async function duckDuckGo(query) {
  const enc = encodeURIComponent(query.trim());
  const data = await fetchJson(
    `https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1&skip_disambig=1`
  );
  if (!data) return [];
  const out = [];
  if (data.AbstractText) {
    out.push({
      source: "duckduckgo",
      title: data.Heading || query,
      text: data.AbstractText,
      url: data.AbstractURL || "",
    });
  }
  const walk = (arr) => {
    for (const t of arr ?? []) {
      if (Array.isArray(t.Topics)) walk(t.Topics);
      else if (t.Text) {
        out.push({ source: "duckduckgo-related", title: "", text: t.Text, url: t.FirstURL || "" });
      }
      if (out.length >= 6) break;
    }
  };
  walk(data.RelatedTopics);
  return out.slice(0, 6);
}

const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","is","are","was",
  "were","be","been","what","who","when","where","why","how","do","does","did",
  "it","its","this","that","as","at","by","from","about","into","over","vs",
]);

/** Cloudflare Worker URL. Configurable via VITE_NEWS_WORKER_URL; falls back to
 *  the known-live worker (the old default, news-worker.overlay365.workers.dev,
 *  does not resolve — a build without the env override silently returned no
 *  headlines). */
const NEWS_WORKER_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_NEWS_WORKER_URL) ||
  "https://news-worker.tap4500.workers.dev";

/**
 * Fetch real news headlines from the news-worker Cloudflare Worker.
 * Returns verified 2026 headlines with source URLs (not Wikipedia stubs).
 *
 * The worker can be slow on cold start and intermittently times out — so on a
 * fetch failure this retries with backoff (an empty-but-successful response is
 * honored immediately: no point retrying a query the worker answered).
 */
async function fetchNews(query, limit = 25) {
  const url = `${NEWS_WORKER_URL}?q=${encodeURIComponent(query)}&limit=${limit}`;
  let lastData = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await fetchJson(url, 15000);
    if (Array.isArray(data?.articles)) {
      lastData = data;
      if (data.articles.length > 0) break; // got headlines
      return []; // worker answered; genuinely no articles for this query
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  if (!Array.isArray(lastData?.articles)) return [];
  return lastData.articles.map((a) => ({
    source: a.source || "news",
    title: a.title || "",
    text: [a.title, a.summary].filter(Boolean).join(" — "),
    url: a.url || "",
    publishedAt: a.publishedAt || "",
  }));
}

/** Query terms used for evidence scoring. */
export function queryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function scoreSentence(text, terms) {
  const lower = ` ${text.toLowerCase()} `;
  let score = 0;
  for (const t of terms) {
    let idx = 0;
    let hits = 0;
    while ((idx = lower.indexOf(t, idx)) !== -1 && hits < 3) {
      hits++;
      idx += t.length;
    }
    score += hits;
  }
  return score;
}

/** Split raw source text into candidate sentences/clauses. */
function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|\s+[·•|-]\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 30 && s.length < 400);
}

/**
 * Run a multi-source research pass on a query.
 *
 * Sources consulted (each degrades gracefully if unreachable):
 *   - "stable" kind: Wikipedia opensearch titles → REST summaries, Wikipedia
 *     full-text search snippets, DuckDuckGo instant answer + related topics,
 *     then optional live Chrome web_search (for freshness).
 *   - "fresh" kind: live Chrome web_search ONLY. Wikipedia and DDG-instant
 *     have no current news, weather, prices, or scores — feeding them in
 *     produces hallucinated answers from unrelated stubs.
 *   - "news" kind: real headlines from the news-worker Cloudflare Worker
 *     (Google News RSS + BBC + AP + NPR + Hacker News). Returns verified
 *     live headlines with source URLs, bypassing encyclopedias entirely.
 *
 * @param {object} opts
 * @param {string} opts.query - research question/topic
 * @param {number} [opts.max_sources=6] - approximate source cap
 * @param {"stable"|"fresh"|"news"} [opts.kind="stable"] - routing kind
 * @param {boolean} [opts.liveWeb=true] - include a Chrome web_search leg
 * @param {Function} [opts.confirm] - confirm callback forwarded to web_search
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @returns {Promise<object>} { ok, query, summary, findings[], sourcesUsed[] }
 */
export async function deepResearch({
  query,
  max_sources = 6,
  kind = "stable",
  liveWeb = true,
  confirm,
  phoneControl,
} = {}) {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, error: "deep_research requires a query" };

  const cap = Math.max(2, Math.min(Number(max_sources) || 6, 12));
  const terms = queryTerms(q);
  const isFresh = kind === "fresh";
  const isNews = kind === "news";

  let findings = [];

  if (isNews) {
    // News queries: real headlines from the news-worker (Google News RSS +
    // BBC + AP + NPR + Hacker News). Wikipedia and DDG have no current news.
    try {
      const articles = await fetchNews(q, cap + 2);
      if (articles.length) {
        findings = articles.map((a) => ({
          source: a.source,
          title: a.title,
          text: a.text,
          url: a.url,
        }));
      } else {
        return {
          ok: false,
          query: q,
          error: "news-worker returned no articles for this query",
          sourcesUsed: [],
          findingsCount: 0,
        };
      }
    } catch (e) {
      return {
        ok: false,
        query: q,
        error: `news-worker unreachable: ${e?.message || "unknown error"}`,
        sourcesUsed: [],
        findingsCount: 0,
      };
    }
  } else if (isFresh) {
    // Time-sensitive query → ONLY trust live sources. Cloud encyclopedias
    // and DDG-instant-answer have no current data on breaking news, prices,
    // weather, or scores; running them pollutes the digest with unrelated
    // stubs that the model stitches into fabricated answers.
  } else {
    // Fan out across cloud sources concurrently; each failure degrades quietly.
    const [titles, searchSnippets, ddg] = await Promise.all([
      wikiTitles(q, Math.min(cap, 5)),
      wikiSearch(q, Math.min(cap, 5)),
      duckDuckGo(q),
    ]);
    const summaries = await wikiSummaries(titles);

    findings = [...summaries, ...searchSnippets, ...ddg].slice(0, cap + 2);
  }

  // Live leg: real Chrome search via the accessibility bridge. Always run
  // for "fresh" (the only source of truth). News kind already has live headlines
  // from the worker — skip the extra round-trip.
  if (!isNews && (liveWeb || isFresh)) {
    try {
      const live = await webSearch({ query: q, confirm, phoneControl });
      if (live?.ok && Array.isArray(live.results) && live.results.length) {
        findings.push({
          source: `chrome-live (${live.provider})`,
          title: q,
          text: live.results.join(" · "),
          url: live.pageUrl || "",
        });
      } else if (isFresh && live && !live.ok) {
        // Surface why the live leg failed for fresh queries.
        return {
          ok: false,
          query: q,
          error: `live web search unavailable: ${live.error || "no results"}`,
          sourcesUsed: [],
          findingsCount: 0,
        };
      }
    } catch (e) {
      if (isFresh) {
        return {
          ok: false,
          query: q,
          error: `live web search failed: ${e?.message || "unknown error"}`,
          sourcesUsed: [],
          findingsCount: 0,
        };
      }
      /* live web is optional for stable queries */
    }
  }

  if (!findings.length) {
    return { ok: false, error: "all research sources failed", query: q };
  }

  // Score + dedupe evidence sentences against the query terms.
  const seenSentences = new Set();
  const ranked = [];
  for (const f of findings) {
    const parts = sentences(f.text);
    const pieces = parts.length ? parts : [String(f.text || "").trim()].filter(Boolean);
    for (const p of pieces) {
      const key = p.toLowerCase().replace(/\W+/g, " ").trim();
      if (key.length < 25 || seenSentences.has(key)) continue;
      seenSentences.add(key);
      ranked.push({ score: scoreSentence(p, terms), text: p, source: f.source, title: f.title, url: f.url });
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  // Digest sized for the model's context window (~5000 chars).
  const digestLines = [];
  let used = 0;
  const bySource = new Map();
  for (const r of ranked) {
    if (digestLines.join("\n").length + r.text.length > 4800) break;
    digestLines.push(`- ${r.text}${r.url ? ` [${r.url}]` : ""}`);
    used++;
    const entry = bySource.get(r.source) || { title: r.title, points: 0 };
    entry.points++;
    bySource.set(r.source, entry);
  }

  const summaryHeader = [
    `RESEARCH DIGEST: ${q}`,
    `Sources consulted (${used} evidence lines from ${bySource.size} sources):`,
    ...[...bySource.entries()].map(([src, v]) => `- ${src}${v.title ? ` — ${v.title}` : ""} (${v.points})`),
    "",
    "Key findings:",
  ].join("\n");

  return {
    ok: true,
    query: q,
    summary: `${summaryHeader}\n${digestLines.join("\n")}`.slice(0, 5500),
    findingsCount: used,
    sourcesUsed: [...bySource.keys()],
  };
}

/** Execute a research-pack tool call. */
export async function execResearchTool(name, args = {}, opts = {}) {
  switch (name) {
    case READ_PAGE_TOOL.name:
      return readPageContext(opts);
    case DEEP_RESEARCH_TOOL.name:
      return deepResearch({ ...args, confirm: opts.confirm, phoneControl: opts.phoneControl });
    default:
      return { ok: false, error: `unknown research tool: ${name}` };
  }
}
