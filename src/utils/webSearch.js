/**
 * webSearch — on-device web research for the local agent.
 *
 * Built on browserNavigate's verified omnibox navigation: the agent starts
 * from ANY page (a restored tab, an app textarea, anything) — navigateTo()
 * owns the only safe path to the results page:
 *
 *   1. Focus Chrome's OMNIBOX (never mid-page fields).
 *   2. Navigate to https://www.google.com/search?q=<query>.
 *   3. VERIFY arrival by checking the live URL before trusting any text.
 *   4. Harvest result lines from the verified page.
 *   5. If anything fails, fall back to factual APIs (Wikipedia/DuckDuckGo)
 *      with honest provenance so the model never presents unverified output
 *      as live browsing.
 */

import { loadPhoneControl } from "./modelRegistry.js";
import { navigateTo } from "./browserNavigate.js";

/** Tool schema the model sees for web research. */
export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the web for current, factual, or unknown information. Drives Chrome itself (navigates to a Google search URL no matter what page is currently open), verifies it arrived at the results page, and returns verified snippets. Base your answer strictly on the returned results — never on memory.",
  parameters: {
    query: { type: "string", description: "The search query or question to research" },
  },
};

const JUNK_LINE =
  /^(google|sign in|all|images|videos|news|more|settings|tools|feedback|about this page|related searches|people also ask)$/i;

/** Fast factual fallback using Wikipedia / instant search when Chrome fails. */
async function fetchFactualFallback(query) {
  try {
    const enc = encodeURIComponent(query.trim());
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`;
    const res = await fetch(wikiUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.extract) {
        return [
          `Title: ${data.title || query}`,
          `Description: ${data.description || ""}`,
          `Summary: ${data.extract}`,
        ].filter(Boolean);
      }
    }
  } catch {
    /* ignore fallback failure */
  }

  try {
    const enc = encodeURIComponent(query.trim());
    const ddgUrl = `https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const snippets = [];
      if (data.AbstractText) snippets.push(`Answer: ${data.AbstractText}`);
      if (data.Heading) snippets.push(`Heading: ${data.Heading}`);
      if (Array.isArray(data.RelatedTopics)) {
        for (const t of data.RelatedTopics.slice(0, 3)) {
          if (t.Text) snippets.push(t.Text);
        }
      }
      if (snippets.length > 0) return snippets;
    }
  } catch {
    /* ignore fallback failure */
  }

  return [];
}

/** Harvest readable result lines from verified results-page text. */
function extractResults(pageText, query) {
  const q = String(query).toLowerCase();
  return pageText
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !JUNK_LINE.test(t))
    .filter((t) => t.toLowerCase() !== q)
    .filter((t) => !/^https?:\/\//i.test(t))
    .slice(0, 20);
}

/**
 * Perform a verified web search by driving Chrome via its omnibox.
 * @param {object} opts
 * @param {string} opts.query
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @param {Function} [opts.confirm] - async ({name,args,description}) => boolean
 * @param {object} [opts.timing] - { settleMs, navTimeoutMs } overrides (tests)
 * @returns {Promise<{ok:boolean, provider?:string, results?:string[], pageUrl?:string, note?:string, chromeError?:string, error?:string}>}
 */
export async function webSearch({ query, phoneControl, confirm, timing = {} } = {}) {
  if (!query) return { ok: false, error: "web_search requires a query" };

  const phone = phoneControl ?? (await loadPhoneControl());
  if (!phone?.getStatus) {
    // No phone control (web/desktop): use fast factual search directly.
    const fallback = await fetchFactualFallback(query);
    if (fallback.length > 0) {
      return {
        ok: true,
        provider: "factual-search",
        results: fallback,
        note: "Results come from Wikipedia/DuckDuckGo APIs (no browser available on this device). Cite them as such.",
      };
    }
    return { ok: false, error: "PhoneControl plugin unavailable" };
  }

  const status = await phone.getStatus().catch(() => ({ enabled: false }));
  if (!status?.enabled) {
    return {
      ok: false,
      error:
        "Accessibility service is not enabled. Ask the user to enable 'Open Chat' in System Settings > Accessibility, then try again.",
      needs_enablement: true,
    };
  }

  if (typeof confirm === "function") {
    const approved = await confirm({
      name: "web_search",
      args: { query },
      description: `Search the web for "${String(query).slice(0, 60)}" in Chrome`,
    });
    if (!approved) {
      return { ok: false, error: "action declined by user", declined: true };
    }
  }

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(String(query))}`;

  try {
    // Verified omnibox navigation — works from ANY starting page/tab.
    const nav = await navigateTo({
      url: searchUrl,
      phoneControl: phone,
      timing,
    });
    if (!nav?.ok) {
      throw new Error(nav?.error || "navigation failed");
    }

    const results = extractResults(nav.text ?? "", query);

    // Return to Open-Chat so the answer is visible without switching back.
    try {
      await phone.openApp({ packageName: "com.openchat.app" });
    } catch {
      /* ignore */
    }

    if (results.length >= 1) {
      return {
        ok: true,
        provider: "chrome",
        pageUrl: nav.url,
        results,
        screenshot: nav.screenshot ?? null,
        vision_summary: nav.vision_summary ?? `[PAGE VISION: ${nav.url}] Title: "${nav.title || "Search Results"}"`,
        note: "These are live Google results read off the verified results page. Base your answer ONLY on them.",
      };
    }

    throw new Error("Reached Google but could not read result snippets off the page.");
  } catch (e) {
    const chromeError = e instanceof Error ? e.message : String(e);

    // Honest fallback: factual APIs, clearly labeled as NOT live browsing.
    try {
      await phone.openApp({ packageName: "com.openchat.app" });
    } catch {
      /* ignore */
    }
    const fallback = await fetchFactualFallback(query);
    if (fallback.length > 0) {
      return {
        ok: true,
        provider: "factual-search",
        results: fallback,
        chromeError,
        note:
          "Live Chrome search could not be completed (" +
          chromeError +
          "). These results come from Wikipedia/DuckDuckGo APIs instead. Say so — do NOT claim you browsed the web.",
      };
    }
    return {
      ok: false,
      chromeError,
      error: `web_search failed: ${chromeError}. No verified sources were reachable — tell the user you could not complete the research instead of answering from memory.`,
    };
  }
}
