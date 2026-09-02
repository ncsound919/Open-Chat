/**
 * pageContext — deterministic page awareness from the accessibility tree.
 *
 * The local model has no vision, so it cannot tell WHICH page it is looking
 * at. readPageContext() extracts the browser URL (omnibox), the tab title,
 * and the readable page text straight from the accessibility tree — no
 * screenshots needed. Shared by the research pack (read_page tool) and the
 * web_search navigator (arrival verification).
 */

import { loadPhoneControl } from "./modelRegistry.js";

/** Tool schema: page awareness. */
export const READ_PAGE_TOOL = {
  name: "read_page",
  description:
    "Read the current browser page: returns the URL, page title, and visible text so you know exactly which page you are on and what it says. Use this after opening or navigating in Chrome before acting further.",
  parameters: {},
};

const URL_LIKE = /^(https?:\/\/|www\.)\S+$/i;
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

/** Chrome's omnibox / page-title widget viewIds. */
const CHROME_URL_VIEWID = /url_bar|url|omnibox|search_bar/i;
const CHROME_TITLE_VIEWID = /title|page_title/i;

function nodeText(n) {
  return String(n.text || n.desc || "").trim();
}

/**
 * Read the current page from the accessibility tree.
 * @param {object} [opts]
 * @param {object} [opts.phoneControl] - preloaded plugin instance
 * @returns {Promise<object>} { ok, url?, title?, text?, foregroundPackage? }
 */
export async function readPageContext({ phoneControl } = {}) {
  const phone = phoneControl ?? (await loadPhoneControl());
  if (!phone?.readScreen) {
    return { ok: false, error: "PhoneControl plugin unavailable" };
  }
  let screen;
  try {
    screen = await phone.readScreen();
  } catch (e) {
    return { ok: false, error: e?.message ?? "readScreen failed" };
  }
  const nodes = screen?.nodes ?? [];
  if (!nodes.length) {
    return { ok: false, error: "No screen content readable", foregroundPackage: screen?.foregroundPackage ?? "" };
  }

  // URL: prefer the omnibox viewId, then any editable URL-like node.
  let url = "";
  const urlNode =
    nodes.find((n) => CHROME_URL_VIEWID.test(String(n.viewId || "")) && nodeText(n)) ||
    nodes.find((n) => n.editable && URL_LIKE.test(nodeText(n))) ||
    nodes.find((n) => n.editable && DOMAIN_LIKE.test(nodeText(n)));
  if (urlNode) {
    url = nodeText(urlNode);
    if (!/^https?:\/\//i.test(url) && DOMAIN_LIKE.test(url)) url = `https://${url}`;
  }

  // Title: prefer a title viewId; else the topmost non-editable text below
  // the omnibox that is not the URL itself (the tab/page title sits above
  // body content, so "first match" beats "longest match").
  let title = "";
  const titleNode = nodes.find(
    (n) => CHROME_TITLE_VIEWID.test(String(n.viewId || "")) && nodeText(n)
  );
  if (titleNode) {
    title = nodeText(titleNode);
  } else {
    const best = nodes.find((n) => {
      if (n.editable) return false;
      const t = nodeText(n);
      if (t.length < 4 || t.length > 200) return false;
      if (URL_LIKE.test(t) || DOMAIN_LIKE.test(t)) return false;
      if (url && t.toLowerCase().includes(url.toLowerCase())) return false;
      return true;
    });
    if (best) title = nodeText(best);
  }

  // Page text: readable lines in vertical order, deduped.
  const seen = new Set();
  const lines = [];
  for (const n of [...nodes]
    .filter((n) => !n.editable && nodeText(n))
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))) {
    const t = nodeText(n);
    if (seen.has(t)) continue;
    seen.add(t);
    lines.push(t);
    if (lines.join("\n").length > 4500) break;
  }

  // Vision capture: attempt native screenshot for visual layout perception.
  let screenshot = null;
  if (typeof phone?.screenshot === "function") {
    try {
      const shot = await phone.screenshot();
      if (shot?.ok !== false) {
        const field = ["data", "uri", "path", "fileUri"].find(
          (k) => typeof shot?.[k] === "string" && shot[k].length > 0
        );
        if (field) screenshot = shot[field];
      }
    } catch {
      /* ignore screenshot errors */
    }
  }

  const vision_summary = `[PAGE VISION: ${url || "Current Page"}] Title: "${title || "Untitled"}" (${lines.length} layout elements visible).`;

  return {
    ok: true,
    url,
    title,
    foregroundPackage: screen?.foregroundPackage ?? "",
    text: lines.join("\n").slice(0, 5000),
    screenshot,
    vision_summary,
  };
}
