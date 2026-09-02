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
  // execPhoneTool("type") submits by default; ask it NOT to so this recipe
  // owns the single submit below (avoids a double Enter / submit on the
  // wrong context).
  await execPhoneTool("type", { text: query, submit: false }, { phoneControl: phone, confirm });
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
