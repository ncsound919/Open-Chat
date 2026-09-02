/**
 * browserNavigate — deterministic omnibox navigation for the on-device agent.
 *
 * Restored Chrome tabs can start ANYWHERE (AI Studio, a doc, last night's
 * cart). The local model cannot see the screen, so letting it tap/type its
 * way to a site means typing into random page fields. This module owns the
 * ONLY safe path: focus the address bar, set the full URL, submit, then
 * VERIFY arrival by checking the live URL before trusting anything on screen.
 */

import { loadPhoneControl } from "./modelRegistry.js";
import { readPageContext } from "./pageContext.js";

/** Tool schema: direct navigation. */
export const NAVIGATE_TOOL = {
  name: "navigate",
  description:
    "Navigate the browser directly to a URL (e.g. https://en.wikipedia.org/wiki/Quantum_computing). Focuses Chrome's address bar, loads the page, verifies arrival, and returns what the page shows. Use this instead of tapping links or typing into page fields.",
  parameters: {
    url: { type: "string", description: "Full URL to load (include https://)" },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Omnibox viewId fragments across Chrome variants. */
const OMNIBOX_VIEWID = /url_bar|search_bar|omnibox|^url$|search_box|location_bar|toolbar/i;
/** Only trust nodes near the top of the screen as address bar candidates. */
const OMNIBOX_MAX_Y = 320;

function normNodes(screen) {
  return (screen?.nodes ?? [])
    .map((n) => ({
      text: (n.text || n.desc || "").trim(),
      clickable: n.clickable === true,
      editable: n.editable === true,
      viewId: String(n.viewId || ""),
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    }))
    .filter((n) => n.text || n.editable);
}

function center(n) {
  return { x: Math.round(n.x + n.w / 2), y: Math.round(n.y + n.h / 2) };
}

/**
 * Locate Chrome's address bar / omnibox:
 * Accepts viewId matches or nodes in the top band (y < 320) whether editable
 * or static (as loaded web pages display static URL bars before focus).
 * Returns null when only mid-page content exists (y >= 320).
 */
export function findOmnibox(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  // 1. viewId match in top band (prefer editable)
  const viewIdMatches = nodes.filter(
    (n) => OMNIBOX_VIEWID.test(n.viewId) && typeof n.y === "number" && n.y < OMNIBOX_MAX_Y
  );
  if (viewIdMatches.length > 0) {
    return viewIdMatches.find((n) => n.editable) || viewIdMatches[0];
  }

  // Explicit viewId match anywhere
  const explicitViewId = nodes.find((n) => OMNIBOX_VIEWID.test(n.viewId));
  if (explicitViewId) return explicitViewId;

  // 2. Top-band nodes (y < OMNIBOX_MAX_Y)
  const topNodes = nodes.filter(
    (n) => typeof n.y === "number" && n.y >= 0 && n.y < OMNIBOX_MAX_Y
  );
  if (topNodes.length === 0) return null;

  // Topmost editable node in top band
  const editableTop = topNodes
    .filter((n) => n.editable)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))[0];
  if (editableTop) return editableTop;

  // Topmost URL-like or address prompt node in top band
  const urlTextTop = topNodes.find(
    (n) =>
      /^(https?:\/\/|www\.)/i.test(n.text) ||
      /search or type/i.test(n.text) ||
      /\.[a-z]{2,}/i.test(n.text)
  );
  if (urlTextTop) return urlTextTop;

  // Topmost node in top band
  return [...topNodes].sort((a, b) => (a.y ?? 0) - (b.y ?? 0))[0] || null;
}

function ensureProtocol(url) {
  const u = String(url ?? "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(u)) return `https://${u}`;
  return u;
}

/** host+path fingerprint of a URL (query ignored). */
function urlFingerprint(rawUrl) {
  try {
    const u = new URL(ensureProtocol(rawUrl));
    return `${u.host.replace(/^www\./i, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when the live page URL points at the same host/path as the target
 * (query strings and trailing slashes ignored).
 */
export function arrivedAt(liveUrl, targetUrl) {
  const want = urlFingerprint(targetUrl);
  if (!want) return false;
  const got = urlFingerprint(liveUrl);
  if (!got) return false;
  // Match exact or a genuine path-prefix (segment boundary). A bare prefix
  // like "/wiki/Quantum" must NOT accept "/wiki/QuantumXYZ" (wrong article).
  return got === want || got.startsWith(`${want}/`);
}

/**
 * Navigate Chrome to a URL via the omnibox, verify arrival, and return vision payload.
 *
 * @param {object} opts
 * @param {string} opts.url - destination URL
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @param {boolean} [opts.launch=true] - bring Chrome to the foreground first
 * @param {object} [opts.timing] - { settleMs, navTimeoutMs } overrides (tests)
 * @returns {Promise<{ok:boolean, url?:string, title?:string, text?:string,
 *   screenshot?:string, vision_summary?:string, foregroundPackage?:string, error?:string, note?:string}>}
 */
export async function navigateTo({
  url,
  phoneControl,
  launch = true,
  timing = {},
} = {}) {
  const target = ensureProtocol(url);
  if (!target || !urlFingerprint(target)) {
    return { ok: false, error: "navigate requires a valid http(s) URL" };
  }

  const phone = phoneControl ?? (await loadPhoneControl());
  if (!phone?.getStatus) {
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

  const settleMs = Number(timing.settleMs) || 1200;
  const navTimeoutMs = Number(timing.navTimeoutMs) || 9000;

  try {
    // Bring Chrome forward (harmless if already there) and let it settle.
    if (launch) {
      await phone.openApp({ packageName: "com.android.chrome" });
      await sleep(settleMs);
    }

    // Omnibox ONLY — locate the address bar even when a page is already loaded
    let omnibox = findOmnibox(normNodes(await phone.readScreen()));
    if (!omnibox) {
      throw new Error(
        "Could not locate Chrome's address bar — refusing to type into page content."
      );
    }

    await phone.performTap(center(omnibox));
    await sleep(600);

    // The omnibox may have moved into an editing layout after focus; re-find.
    omnibox = findOmnibox(normNodes(await phone.readScreen())) || omnibox;

    await phone.inputText({ text: target });
    await sleep(500);
    if (typeof phone.submitText === "function") {
      try {
        await phone.submitText();
      } catch {
        /* verification loop decides success */
      }
    }

    // VERIFY arrival against the target host/path before trusting anything.
    const deadline = Date.now() + navTimeoutMs;
    let page = null;
    while (Date.now() < deadline) {
      await sleep(700);
      page = await readPageContext({ phoneControl: phone }).catch(() => null);
      if (page?.ok && arrivedAt(page.url, target)) break;
      page = null;
    }
    if (!page) {
      throw new Error("Chrome did not reach the requested page in time.");
    }

    return {
      ok: true,
      url: page.url,
      title: page.title,
      foregroundPackage: page.foregroundPackage,
      text: page.text,
      screenshot: page.screenshot ?? null,
      vision_summary: page.vision_summary ?? `[PAGE VISION: ${page.url}] Title: "${page.title}"`,
      note: "Navigation verified. Changed Chrome URL to target site. You are on this page now — use read_page any time to re-check where you are.",
    };
  } catch (e) {
    return {
      ok: false,
      error:
        (e instanceof Error ? e.message : String(e)) +
        " Tell the user navigation failed instead of answering from memory.",
    };
  }
}
