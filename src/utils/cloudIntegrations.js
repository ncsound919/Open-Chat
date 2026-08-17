/**
 * cloudIntegrations — keyless cloud integrations for the on-device agent.
 *
 * Wikipedia (search + summary) and News (Google News RSS). No credentials,
 * no OAuth. Every request sets an identifying User-Agent (Wikimedia returns
 * HTTP 403 without one) and a timeout; every tool fails soft with a
 * serializable { ok:false, error } result.
 */

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary";
const NEWS_BASE = "https://news.google.com/rss/search";
const USER_AGENT = "OpenChat/1.0 (local-first chat app)";
const TIMEOUT_MS = 20_000;

/** Tool schemas the model sees (name/description/parameters shape matches PHONE_TOOLS). */
export const CLOUD_TOOLS = [
  {
    name: "wikipedia_search",
    description:
      "Search Wikipedia and return matching article titles, snippets, and URLs.",
    parameters: {
      query: { type: "string", description: "The search term" },
      limit: { type: "number", description: "Max results (default 5)" },
    },
  },
  {
    name: "wikipedia_summary",
    description:
      "Return the plain-text introduction of a Wikipedia article by exact title.",
    parameters: {
      title: { type: "string", description: "Wikipedia article title" },
    },
  },
  {
    name: "news_headlines",
    description:
      "Return recent news headlines. Pass a topic (world, tech, business, sports, science, health) or any search query.",
    parameters: {
      topic: { type: "string", description: "Topic or search query" },
      count: { type: "number", description: "Max headlines (default 8)" },
    },
  },
];

/** Set of tool names, for O(1) routing checks. */
export const CLOUD_TOOL_NAMES = new Set(CLOUD_TOOLS.map((t) => t.name));

/** Strip HTML tags + decode a few common entities from a Wikipedia snippet. */
function stripTags(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * Search Wikipedia via the Action API.
 * `origin=*` is required for CORS from a Capacitor WebView.
 * @returns {Promise<{ok:boolean, provider?:string, results?:Array, error?:string}>}
 */
export async function wikipediaSearch({ query, limit = 5 } = {}) {
  if (!query) return { ok: false, error: "wikipedia_search requires a query" };
  try {
    const url =
      `${WIKI_API}?action=query&list=search&prop=info&inprop=url&format=json` +
      `&origin=*&srlimit=${Math.min(Math.max(Number(limit) || 5, 1), 20)}` +
      `&srsearch=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `Wikipedia search HTTP ${res.status}` };
    const data = await res.json();
    const hits = data?.query?.search ?? [];
    const results = hits.map((h) => ({
      title: h.title,
      snippet: stripTags(h.snippet),
      url: h.url ?? "",
    }));
    return { ok: true, provider: "wikipedia", results };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetch a Wikipedia article's plain-text intro via the REST summary endpoint.
 * @returns {Promise<{ok:boolean, provider?:string, title?:string, extract?:string, error?:string}>}
 */
export async function wikipediaSummary({ title } = {}) {
  if (!title) return { ok: false, error: "wikipedia_summary requires a title" };
  try {
    const url = `${WIKI_REST}/${encodeURIComponent(String(title).replace(/ /g, "_"))}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `Wikipedia summary HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      provider: "wikipedia",
      title: data?.title ?? title,
      extract: data?.extract ?? "",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Parse an RSS XML string into { title, source, link, published } items. */
function parseRss(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return Array.from(doc.querySelectorAll("item")).map((item) => ({
    title: item.querySelector("title")?.textContent ?? "",
    source: item.querySelector("source")?.textContent ?? "",
    link: item.querySelector("link")?.textContent ?? "",
    published: item.querySelector("pubDate")?.textContent ?? "",
  }));
}

/**
 * Fetch recent headlines from the keyless Google News RSS search endpoint.
 * @returns {Promise<{ok:boolean, provider?:string, headlines?:Array, error?:string}>}
 */
export async function newsHeadlines({ topic = "world", count = 8 } = {}) {
  try {
    const url =
      `${NEWS_BASE}?q=${encodeURIComponent(String(topic))}` +
      "&hl=en-US&gl=US&ceid=US:en";
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `News RSS HTTP ${res.status}` };
    const xml = await res.text();
    const headlines = parseRss(xml)
      .slice(0, Math.min(Math.max(Number(count) || 8, 1), 20))
      .map((i) => ({
        title: i.title,
        source: i.source,
        link: i.link,
        published: i.published,
      }));
    return { ok: true, provider: "google-news", headlines };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Dispatch a cloud tool by name.
 * @param {string} name
 * @param {object} [args]
 * @returns {Promise<object>} serializable result
 */
export async function runCloudTool(name, args = {}) {
  switch (name) {
    case "wikipedia_search":
      return wikipediaSearch(args);
    case "wikipedia_summary":
      return wikipediaSummary(args);
    case "news_headlines":
      return newsHeadlines(args);
    default:
      return { ok: false, error: `unknown cloud tool: ${name}` };
  }
}
