# Third-Party Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the on-device Open-Chat agent keyless access to Wikipedia + News (cloud) and to the user's Gmail, Calendar, Drive/Files, Gemini, and YouTube apps (phone accessibility recipes).

**Architecture:** Two new modules (`cloudIntegrations.js` for Wikipedia/News, `appRecipes.js` for composed phone recipes) exposing tool schemas + dispatch functions, registered in `LocalModelClient.send()` (tool list + `toolHandler` routing + system-prompt section) and wired into `buildSkillExecutors` for the worker loop. A small native hardening of `PhoneControlPlugin.getStatus` for Android 16.

**Tech Stack:** React 19 + Vite, Vitest (jsdom), Capacitor, an existing native Android PhoneControl accessibility plugin.

**Spec:** `docs/superpowers/specs/2026-08-17-third-party-integrations-design.md`

**Commands used throughout:** `npm run lint` (zero warnings) and `npm test` run from the `Open-Chat/` directory.

---

### Task 1: `cloudIntegrations.js` — Wikipedia + News keyless cloud tools

**Files:**
- Create: `src/utils/cloudIntegrations.js`
- Test: `src/utils/cloudIntegrations.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/utils/cloudIntegrations.test.js`:

```js
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
    expect(fetchMockUrl()).toContain("/api/rest_v1/page/summary/Albert_Einstein");

    function fetchMockUrl() {
      return global.fetch.mock.calls[0][0];
    }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/cloudIntegrations.test.js`
Expected: FAIL — module `./cloudIntegrations.js` cannot be resolved (file does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/utils/cloudIntegrations.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/cloudIntegrations.test.js`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/cloudIntegrations.js src/utils/cloudIntegrations.test.js
git commit -m "feat(open-chat): keyless Wikipedia + News cloud tools"
```

---

### Task 2: `appRecipes.js` — phone-driven app recipes

**Files:**
- Create: `src/utils/appRecipes.js`
- Test: `src/utils/appRecipes.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/utils/appRecipes.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RECIPE_TOOLS,
  gmailInbox,
  calendarEvents,
  driveBrowse,
  geminiQuery,
  youtubeSearch,
  runRecipe,
} from "./appRecipes.js";

vi.mock("./modelRegistry.js", () => ({
  loadPhoneControl: vi.fn(async () => ({
    getStatus: async () => ({ enabled: true }),
    openApp: async () => ({ ok: true }),
    submitText: async () => ({ ok: true }),
    readScreen: async () => ({ nodes: [] }),
  })),
}));

vi.mock("./phoneTools.js", () => ({
  execPhoneTool: vi.fn(async (name, args, opts) => {
    if (typeof opts?.confirm === "function") {
      await opts.confirm({ name, args, description: `run ${name}` });
    }
    switch (name) {
      case "open_app":
        return { ok: true };
      case "read_screen":
        return {
          ok: true,
          elements: [
            { text: "Subject: Hello", editable: false, x: 0, y: 0, w: 100, h: 20 },
            { text: "", editable: true, x: 10, y: 200, w: 200, h: 40 },
          ],
        };
      case "tap":
        return { ok: true };
      case "type":
        return { ok: true };
      default:
        return { ok: true };
    }
  }),
}));

import { execPhoneTool } from "./phoneTools.js";

describe("appRecipes tool schemas", () => {
  it("defines the five recipe tools", () => {
    expect(RECIPE_TOOLS.map((t) => t.name)).toEqual([
      "gmail_inbox",
      "calendar_events",
      "drive_browse",
      "gemini_query",
      "youtube_search",
    ]);
  });
});

describe("gmailInbox", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens Gmail, reads the screen, and returns elements", async () => {
    const confirm = vi.fn(async () => true);
    const res = await gmailInbox({ confirm });
    expect(res.ok).toBe(true);
    expect(res.app).toBe("com.google.android.gm");
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.gm" },
      expect.anything()
    );
    expect(execPhoneTool).toHaveBeenCalledWith("read_screen", {}, expect.anything());
    expect(res.elements[0].text).toContain("Subject: Hello");
  });

  it("declines when the user does not confirm", async () => {
    const confirm = vi.fn(async () => false);
    const res = await gmailInbox({ confirm });
    expect(res.ok).toBe(false);
    expect(res.declined).toBe(true);
  });
});

describe("geminiQuery", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens Gemini, types the query, submits, and reads the answer", async () => {
    const confirm = vi.fn(async () => true);
    const res = await geminiQuery({ query: "what is 2+2", confirm });
    expect(res.ok).toBe(true);
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.apps.bard" },
      expect.anything()
    );
    expect(execPhoneTool).toHaveBeenCalledWith(
      "type",
      { text: "what is 2+2" },
      expect.anything()
    );
  });

  it("fails soft without a query", async () => {
    const res = await geminiQuery({ query: "", confirm: vi.fn(async () => true) });
    expect(res.ok).toBe(false);
  });
});

describe("runRecipe dispatch", () => {
  it("routes unknown names to a soft failure", async () => {
    const res = await runRecipe("nope", {}, {});
    expect(res.ok).toBe(false);
  });

  it("dispatches gmail_inbox", async () => {
    const confirm = vi.fn(async () => true);
    const res = await runRecipe("gmail_inbox", {}, { confirm });
    expect(res.ok).toBe(true);
  });
});
```

Note: this test uses `vi.useFakeTimers()`? No — the `execPhoneTool` mock resolves immediately, and the recipes' internal `sleep()` calls still wait real time. To keep the test fast, the recipes below must accept small waits in tests. See Step 3: the recipe helpers read `opts.waitMs` / `opts.sleepMs` with small defaults, but to keep production waits realistic while keeping tests fast, the test relies on the mock resolving and the sleeps being short in the mocked flow. The `sleep` helper is a module constant; if tests are too slow, wrap this file's tests with `vi.useFakeTimers()` and advance — but the defaults below (2500ms etc.) keep the whole suite under the 20s timeout even with the few recipe tests. Acceptable as-is.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/appRecipes.test.js`
Expected: FAIL — module `./appRecipes.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/utils/appRecipes.js`:

```js
/**
 * appRecipes — composed phone-driven recipes that let the on-device agent read
 * the user's actual apps (Gmail, Calendar, Drive/Files, Gemini, YouTube).
 *
 * Each recipe composes the low-level execPhoneTool primitives and reuses the
 * existing user-confirmation gate for every mutating action (opening an app,
 * tapping, typing). Results are trimmed so they don't blow the model context.
 * Recipes are best-effort: a failed step returns a partial result + error.
 */

import { loadPhoneControl } from "./modelRegistry.js";
import { execPhoneTool } from "./phoneTools.js";

/** Tool schemas the model sees. */
export const RECIPE_TOOLS = [
  {
    name: "gmail_inbox",
    description:
      "Open Gmail and read the current inbox, returning visible sender/subject lines.",
    parameters: {},
  },
  {
    name: "calendar_events",
    description:
      "Open Google Calendar and read the current view, returning visible event titles and times.",
    parameters: {},
  },
  {
    name: "drive_browse",
    description:
      "Open Google Drive/Files and read visible file and folder names.",
    parameters: {},
  },
  {
    name: "gemini_query",
    description:
      "Open the Gemini app, ask it a question, and read the answer. args: { query }.",
    parameters: { query: { type: "string", description: "Question to ask Gemini" } },
  },
  {
    name: "youtube_search",
    description:
      "Open YouTube and search for videos, returning visible result titles. args: { query }.",
    parameters: { query: { type: "string", description: "Search term" } },
  },
];

/** Set of recipe names, for O(1) routing checks. */
export const RECIPE_NAMES = new Set(RECIPE_TOOLS.map((t) => t.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve the phone plugin and confirm accessibility is enabled. */
async function requirePhone(opts) {
  const phone = opts?.phoneControl ?? (await loadPhoneControl());
  if (!phone?.getStatus) return { phone: null, error: "PhoneControl plugin unavailable" };
  const status = await phone.getStatus().catch(() => ({ enabled: false }));
  if (!status?.enabled) {
    return {
      phone: null,
      error:
        "Accessibility service is not enabled. Ask the user to enable 'Open Chat' in System Settings > Accessibility, then try again.",
      needs_enablement: true,
    };
  }
  return { phone, error: null };
}

/** Gate a mutating recipe behind user confirmation. */
async function gate(confirm, name, args, description) {
  if (typeof confirm !== "function") return false;
  return confirm({ name, args, description });
}

/** Open an app, wait, and read the screen back (trimmed). */
async function openAndRead(phone, confirm, pkg, { waitMs = 2500, max = 40 } = {}) {
  const open = await execPhoneTool("open_app", { package_name: pkg }, { phoneControl: phone, confirm });
  if (!open.ok) return { ok: false, error: open.error ?? "open failed", app: pkg };
  await sleep(waitMs);
  const screen = await execPhoneTool("read_screen", {}, { phoneControl: phone, confirm });
  return { ok: true, app: pkg, elements: (screen.elements ?? []).slice(0, max) };
}

/**
 * Open an app with a search/input field, type `query`, submit, and read back.
 * Used by gemini_query and youtube_search.
 */
async function askApp(phone, confirm, pkg, query, { searchHint = /search|ask|type|enter|chat/i, waitMs = 5000, max = 20 } = {}) {
  const open = await execPhoneTool("open_app", { package_name: pkg }, { phoneControl: phone, confirm });
  if (!open.ok) return { ok: false, error: open.error ?? "open failed", app: pkg };
  await sleep(2500);
  let screen = await execPhoneTool("read_screen", {}, { phoneControl: phone, confirm });
  let els = screen.elements ?? [];
  const field = els.find((n) => n.editable) ?? els.find((n) => searchHint.test(n.text || ""));
  if (!field) {
    return { ok: false, error: `Could not find an input field in ${pkg}.`, screen: els.slice(0, 8) };
  }
  await execPhoneTool(
    "tap",
    { x: field.x + Math.round(field.w / 2), y: field.y + Math.round(field.h / 2) },
    { phoneControl: phone, confirm }
  );
  await sleep(800);
  await execPhoneTool("type", { text: query }, { phoneControl: phone, confirm });
  await sleep(500);
  if (typeof phone.submitText === "function") {
    await phone.submitText().catch(() => {});
  }
  await sleep(waitMs);
  screen = await execPhoneTool("read_screen", {}, { phoneControl: phone, confirm });
  try {
    await phone.openApp({ packageName: "com.openchat.app" });
  } catch {
    /* reopening Open-Chat is best-effort */
  }
  return { ok: true, app: pkg, query, elements: (screen.elements ?? []).slice(0, max) };
}

/** Open Gmail and read the inbox. */
export async function gmailInbox(opts = {}) {
  const { phone, error } = await requirePhone(opts);
  if (error) return { ok: false, error };
  const approved = await gate(opts.confirm, "gmail_inbox", {}, "Open Gmail and read the inbox");
  if (!approved) return { ok: false, error: "action declined by user", declined: true };
  try {
    return await openAndRead(phone, opts.confirm, "com.google.android.gm");
  } catch (e) {
    return { ok: false, error: `gmail_inbox failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Open Google Calendar and read the current view. */
export async function calendarEvents(opts = {}) {
  const { phone, error } = await requirePhone(opts);
  if (error) return { ok: false, error };
  const approved = await gate(opts.confirm, "calendar_events", {}, "Open Google Calendar and read the current view");
  if (!approved) return { ok: false, error: "action declined by user", declined: true };
  try {
    return await openAndRead(phone, opts.confirm, "com.google.android.calendar", { waitMs: 3000 });
  } catch (e) {
    return { ok: false, error: `calendar_events failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Open Google Drive (fallback: Files) and read visible names. */
export async function driveBrowse(opts = {}) {
  const { phone, error } = await requirePhone(opts);
  if (error) return { ok: false, error };
  const approved = await gate(opts.confirm, "drive_browse", {}, "Open Google Drive/Files and read visible files");
  if (!approved) return { ok: false, error: "action declined by user", declined: true };
  try {
    let res = await openAndRead(phone, opts.confirm, "com.google.android.apps.docs");
    if (!res.ok) {
      res = await openAndRead(phone, opts.confirm, "com.google.android.documentsui");
    }
    return res;
  } catch (e) {
    return { ok: false, error: `drive_browse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Open Gemini, ask a question, read the answer. */
export async function geminiQuery({ query, confirm, phoneControl } = {}) {
  if (!query) return { ok: false, error: "gemini_query requires a query" };
  const { phone, error } = await requirePhone({ confirm, phoneControl });
  if (error) return { ok: false, error };
  const approved = await gate(confirm, "gemini_query", { query }, `Ask Gemini: "${String(query).slice(0, 60)}"`);
  if (!approved) return { ok: false, error: "action declined by user", declined: true };
  try {
    return await askApp(phone, confirm, "com.google.android.apps.bard", query, {
      searchHint: /ask|type|enter|chat/i,
    });
  } catch (e) {
    return { ok: false, error: `gemini_query failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Open YouTube, search, read the video result titles. */
export async function youtubeSearch({ query, confirm, phoneControl } = {}) {
  if (!query) return { ok: false, error: "youtube_search requires a query" };
  const { phone, error } = await requirePhone({ confirm, phoneControl });
  if (error) return { ok: false, error };
  const approved = await gate(confirm, "youtube_search", { query }, `Search YouTube for "${String(query).slice(0, 60)}"`);
  if (!approved) return { ok: false, error: "action declined by user", declined: true };
  try {
    return await askApp(phone, confirm, "com.google.android.youtube", query, {
      searchHint: /search/i,
      waitMs: 6000,
    });
  } catch (e) {
    return { ok: false, error: `youtube_search failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Dispatch a phone recipe by name.
 * @param {string} name
 * @param {object} [args] - recipe args (e.g. { query })
 * @param {object} [opts] - { confirm, phoneControl }
 * @returns {Promise<object>} serializable result
 */
export async function runRecipe(name, args = {}, opts = {}) {
  const merged = { ...opts, ...(args ?? {}) };
  switch (name) {
    case "gmail_inbox":
      return gmailInbox(merged);
    case "calendar_events":
      return calendarEvents(merged);
    case "drive_browse":
      return driveBrowse(merged);
    case "gemini_query":
      return geminiQuery(merged);
    case "youtube_search":
      return youtubeSearch(merged);
    default:
      return { ok: false, error: `unknown recipe: ${name}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/appRecipes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/appRecipes.js src/utils/appRecipes.test.js
git commit -m "feat(open-chat): phone-driven app recipes (Gmail, Calendar, Drive, Gemini, YouTube)"
```

---

### Task 3: Register tools + routing in `LocalModelClient`

**Files:**
- Modify: `src/protocols/LocalModelClient.js:10-17` (imports), `:115-127` (tool list + prompt), `:137-145` (toolHandler)
- Test: `src/protocols/LocalModelClient.test.js`

- [ ] **Step 1: Write the failing test**

Add these mocks and test to `src/protocols/LocalModelClient.test.js`. Insert the two `vi.mock(...)` blocks after the existing `draymondTools` mock (after line 45), and the new `it(...)` block at the end of the `describe` (after line 120).

Mocks to add:

```js
vi.mock("../utils/cloudIntegrations.js", () => ({
  CLOUD_TOOLS: [{ name: "wikipedia_search", description: "d", parameters: {} }],
  CLOUD_TOOL_NAMES: new Set(["wikipedia_search"]),
  runCloudTool: vi.fn(async (name, args) => ({ ok: true, name })),
}));

vi.mock("../utils/appRecipes.js", () => ({
  RECIPE_TOOLS: [{ name: "gmail_inbox", description: "d", parameters: {} }],
  RECIPE_NAMES: new Set(["gmail_inbox"]),
  runRecipe: vi.fn(async (name, args, opts) => ({ ok: true, name })),
}));
```

Import the mocks (add near the other `import` lines after the mocks):

```js
import { runCloudTool } from "../utils/cloudIntegrations.js";
import { runRecipe } from "../utils/appRecipes.js";
```

New test to add at the end of the `describe` block:

```js
it("registers cloud + recipe tools and routes them", async () => {
  let capturedTools = [];
  chatLocal.mockImplementation(async ({ tools, toolHandler }) => {
    capturedTools = tools;
    await toolHandler("wikipedia_search", { query: "x" });
    await toolHandler("gmail_inbox", {});
    return { text: "done", toolCalls: [], usedTools: [] };
  });

  const confirm = vi.fn(async () => true);
  const client = new LocalModelClient(
    { id: "local", model: "auto", phoneToolsEnabled: true, galaxySkillsEnabled: false },
    { confirmAction: confirm }
  );

  await client.send("research and check my inbox", () => {});

  expect(capturedTools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "wikipedia_search" }),
      expect.objectContaining({ name: "gmail_inbox" }),
    ])
  );
  expect(runCloudTool).toHaveBeenCalledWith("wikipedia_search", { query: "x" });
  expect(runRecipe).toHaveBeenCalledWith("gmail_inbox", {}, expect.objectContaining({ confirm }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/protocols/LocalModelClient.test.js`
Expected: FAIL — `runCloudTool` / `runRecipe` are `undefined` (imported from modules the client does not yet use / no routing).

- [ ] **Step 3: Write the implementation**

Modify `src/protocols/LocalModelClient.js`:

1. Add imports (after the `imageGen` import on line 14):

```js
import {
  CLOUD_TOOLS,
  CLOUD_TOOL_NAMES,
  runCloudTool,
} from "../utils/cloudIntegrations.js";
import {
  RECIPE_TOOLS,
  RECIPE_NAMES,
  runRecipe,
} from "../utils/appRecipes.js";
```

2. Add a module-level integration context string (place near `LOCAL_PROVIDER_HINTS`, after line 25):

```js
/** System-prompt section telling the agent which integrations exist. */
const INTEGRATIONS_CONTEXT = [
  "INTEGRATIONS:",
  "- wikipedia_search(query): look up facts/background on Wikipedia (cloud, fast).",
  "- wikipedia_summary(title): get a short article intro.",
  "- news_headlines(topic or query): get recent headlines.",
  "- gmail_inbox / calendar_events / drive_browse: open the phone app and read the screen.",
  "- gemini_query(query) / youtube_search(query): open the app, ask/search, and read the result.",
  "- Prefer the wikipedia/news cloud tools for factual info; use the phone recipes to read the user's actual Gmail/Calendar/Drive/Gemini/YouTube.",
].join("\n");
```

3. In `send()`, add the new tools to the `tools` array (after line 117, `tools.push(WEB_SEARCH_TOOL);`):

```js
    if (this.phoneToolsEnabled) tools.push(...CLOUD_TOOLS);
    if (this.phoneToolsEnabled) tools.push(...RECIPE_TOOLS);
```

4. In `send()`, append the integration section to the system prompt (replace lines 125-126):

```js
    const appSection = this.phoneToolsEnabled ? await this._appContext() : "";
    const integrationSection = this.phoneToolsEnabled ? INTEGRATIONS_CONTEXT : "";
    const systemPrompt = [this.systemPrompt, appSection, integrationSection]
      .filter(Boolean)
      .join("\n\n");
```

5. In `toolHandler` (inside `send()`, before the `draymondToolHandler` check around line 141), add routing:

```js
        if (CLOUD_TOOL_NAMES.has(name)) {
          return runCloudTool(name, args);
        }
        if (RECIPE_NAMES.has(name)) {
          return runRecipe(name, args, { confirm: this.confirmAction });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/protocols/LocalModelClient.test.js`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/protocols/LocalModelClient.js src/protocols/LocalModelClient.test.js
git commit -m "feat(open-chat): register and route cloud + recipe tools in LocalModelClient"
```

---

### Task 4: Wire integrations into `buildSkillExecutors`

**Files:**
- Modify: `src/utils/skillExecutors.js:17-20` (imports) and the returned handler object (`:162-207`)
- Test: `src/utils/skillExecutors.test.js`

- [ ] **Step 1: Write the failing test**

Add a test to `src/utils/skillExecutors.test.js` (which already has a `makeDeps()` helper and imports `buildSkillExecutors`). The cloud handler invokes a real `fetch`, so mock `global.fetch` for that assertion:

```js
it("wires cloud and recipe tool handlers", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { search: [] } }) });
  const handlers = buildSkillExecutors(makeDeps());

  const names = [
    "wikipedia_search",
    "wikipedia_summary",
    "news_headlines",
    "gmail_inbox",
    "calendar_events",
    "drive_browse",
    "gemini_query",
    "youtube_search",
  ];
  for (const n of names) {
    expect(typeof handlers[n]).toBe("function");
  }

  const cloud = await handlers.wikipedia_search({ query: "x" });
  expect(cloud.ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/skillExecutors.test.js`
Expected: FAIL — `handlers.wikipedia_search` is `undefined`.

- [ ] **Step 3: Write the implementation**

Modify `src/utils/skillExecutors.js`:

1. Add imports (after line 20, `import { webSearch } from "./webSearch.js";`):

```js
import { runCloudTool } from "./cloudIntegrations.js";
import { runRecipe } from "./appRecipes.js";
```

2. Add the new handlers to the returned object (inside the `return { ... }` block, after the `web:` entry around line 205):

```js
    // Third-party integrations (keyless cloud + phone recipes).
    wikipedia_search: (ctx) => runCloudTool("wikipedia_search", toolArgs(ctx)),
    wikipedia_summary: (ctx) => runCloudTool("wikipedia_summary", toolArgs(ctx)),
    news_headlines: (ctx) => runCloudTool("news_headlines", toolArgs(ctx)),
    gmail_inbox: (ctx) => runRecipe("gmail_inbox", toolArgs(ctx), { confirm }),
    calendar_events: (ctx) => runRecipe("calendar_events", toolArgs(ctx), { confirm }),
    drive_browse: (ctx) => runRecipe("drive_browse", toolArgs(ctx), { confirm }),
    gemini_query: (ctx) => runRecipe("gemini_query", toolArgs(ctx), { confirm }),
    youtube_search: (ctx) => runRecipe("youtube_search", toolArgs(ctx), { confirm }),
```

Note: `confirm` is already a destructured param of `buildSkillExecutors` (line 42), so it is in scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/skillExecutors.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillExecutors.js src/utils/skillExecutors.test.js
git commit -m "feat(open-chat): wire cloud + recipe tools into skill executors"
```

---

### Task 5: Android 16 `getStatus` hardening (native)

**Files:**
- Modify: `src/plugins/capacitor-phone-control/android/src/main/java/com/openchat/phonecontrol/PhoneControlPlugin.kt:21-27`

- [ ] **Step 1: Understand the change**

The plugin reports `enabled` from the in-memory `PhoneControlAccessibilityService.instance`. On Android 16+, `Settings.Secure` is restricted for third-party apps, and there are cases where the in-memory instance is null even though the service is enabled (e.g. the service just restarted). The robust check is `AccessibilityManager.getEnabledAccessibilityServiceList(...)`.

- [ ] **Step 2: Apply the edit**

Replace the `getStatus` method in `PhoneControlPlugin.kt`:

```kotlin
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        var enabled = PhoneControlAccessibilityService.instance != null
        if (!enabled) {
            // Android 16+ restricts Settings.Secure for third-party apps, so
            // fall back to the accessibility manager's enabled-service list.
            val am = context.getSystemService(android.content.Context.ACCESSIBILITY_SERVICE)
                    as? android.view.accessibility.AccessibilityManager
            val services = am?.getEnabledAccessibilityServiceList(
                android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
            )
            enabled = services?.any { info ->
                info.resolveInfo?.serviceInfo?.packageName == context.packageName
            } == true
        }
        ret.put("enabled", enabled)
        ret.put("available", true)
        call.resolve(ret)
    }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx cap sync android`
Expected: The Gradle sync succeeds with no new errors (Kotlin changes to the plugin are picked up on the next Android build). If you have the Android SDK/gradle available, run `gradlew :capacitor-phone-control:compileDebugKotlin` from `android/` to confirm the Kotlin compiles.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/capacitor-phone-control/android/src/main/java/com/openchat/phonecontrol/PhoneControlPlugin.kt
git commit -m "fix(open-chat): harden PhoneControl getStatus for Android 16"
```

---

### Task 6: Lint + full test run

**Files:** none (verification only)

- [ ] **Step 1: Run the linter**

Run: `npm run lint`
Expected: no warnings / no errors (zero warnings enforced by `--max-warnings 0`). Fix any new lint issues in the files from Tasks 1-4.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `cloudIntegrations.test.js`, `appRecipes.test.js`, and the updated `LocalModelClient.test.js` / `skillExecutors.test.js`.

- [ ] **Step 3: Commit any lint fixes**

If Step 1 produced fixes:

```bash
git add -A
git commit -m "style(open-chat): lint fixes for third-party integrations"
```

(If no fixes were needed, skip this step.)

---

## Self-Review

**Spec coverage:**
- Cloud Wikipedia search + summary + News RSS → Task 1. ✅
- Phone recipes for Gmail, Calendar, Drive/Files, Gemini, YouTube → Task 2. ✅
- Registration + routing in `LocalModelClient` + system-prompt section → Task 3. ✅
- Worker executor wiring (`buildSkillExecutors`) → Task 4. ✅
- Android 16 `getStatus` hardening → Task 5. ✅
- Lint + tests → Task 6. ✅

**Type consistency:** All tool names (`wikipedia_search`, `wikipedia_summary`, `news_headlines`, `gmail_inbox`, `calendar_events`, `drive_browse`, `gemini_query`, `youtube_search`) are defined once in each module's schema array and reused for `CLOUD_TOOL_NAMES` / `RECIPE_NAMES`, `runCloudTool` / `runRecipe` dispatch, `LocalModelClient` routing, and `skillExecutors` keys — no drift.

**Ambiguity:** The `appRecipes` test relies on jsdom (DOMParser not needed here, but `setTimeout` sleeps run for real); all recipe tests complete within the 20s test timeout. If a recipe test is slow, wrap its `describe` with `vi.useFakeTimers()` and `await vi.advanceTimersByTimeAsync(20000)`.
