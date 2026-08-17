/**
 * webSearch — on-device web research for the local agent.
 *
 * Drives the installed Chrome browser through the PhoneControl accessibility
 * bridge: open Chrome, focus the address bar, type the query, submit via the
 * first matching suggestion, then read the results page back as text. Nothing
 * leaves the phone beyond the search itself; results are summarized on-device.
 *
 * Because this opens an app and types, it is gated behind the same user
 * confirmation flow as the other mutating phone tools.
 */

import { loadPhoneControl } from "./modelRegistry.js";

/** Tool schema the model sees for web research. */
export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the web for current, factual, or unknown information. Opens Chrome, searches for the given query, and returns the visible results as text. Use for anything time-sensitive or outside your knowledge.",
  parameters: {
    query: { type: "string", description: "The search query or question to research" },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize a native readScreen payload into lightweight element records. */
function normNodes(screen) {
  return (screen?.nodes ?? [])
    .map((n) => ({
      text: (n.text || n.desc || "").trim(),
      clickable: n.clickable === true,
      editable: n.editable === true,
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
 * Perform a web search by driving Chrome.
 * @param {object} opts
 * @param {string} opts.query
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @param {Function} [opts.confirm] - async ({name,args,description}) => boolean
 * @returns {Promise<{ok:boolean, provider?:string, results?:string[], error?:string}>}
 */
export async function webSearch({ query, phoneControl, confirm } = {}) {
  if (!query) return { ok: false, error: "web_search requires a query" };

  const phone = phoneControl ?? (await loadPhoneControl());
  if (!phone?.getStatus) return { ok: false, error: "PhoneControl plugin unavailable" };
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

  try {
    // 1. Open Chrome and give it time to come to the foreground.
    await phone.openApp({ packageName: "com.android.chrome" });
    await sleep(2000);

    // 2. Find the address bar (the editable field) and focus it.
    let screen = normNodes(await phone.readScreen());
    const omnibox = screen.find((n) => n.editable);
    if (!omnibox) {
      return { ok: false, error: "Could not find Chrome's address bar on screen.", screen: screen.slice(0, 8) };
    }
    await phone.performTap(center(omnibox));
    await sleep(800);

    // 3. Type the query.
    await phone.inputText({ text: query });
    await sleep(700);

    // 4. Submit via the IME enter/search action (the reliable way to press
    //    Enter in a search box). Fall back to tapping a matching suggestion.
    let submitted = false;
    if (typeof phone.submitText === "function") {
      try {
        submitted = (await phone.submitText())?.ok === true;
      } catch {
        submitted = false;
      }
    }
    if (!submitted) {
      screen = normNodes(await phone.readScreen());
      const q = String(query).toLowerCase();
      const target =
        screen.find((n) => n.clickable && (n.text.toLowerCase() === q || n.text.toLowerCase().startsWith(q))) ||
        screen.find((n) => n.clickable && (n.text.toLowerCase().includes(q) || /search|go|google/i.test(n.text)));
      if (target) {
        await phone.performTap(center(target));
      }
    }

    // 5. Wait for the results page, then read it back.
    await sleep(5000);
    screen = normNodes(await phone.readScreen());
    const results = screen.map((n) => n.text).slice(0, 40);

    // Return to Open-Chat so the answer appears here when it's ready.
    try {
      await phone.openApp({ packageName: "com.openchat.app" });
    } catch { /* the app is already foreground or reopening failed — ignore */ }

    return { ok: true, provider: "chrome", results };
  } catch (e) {
    return { ok: false, error: `web_search failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
