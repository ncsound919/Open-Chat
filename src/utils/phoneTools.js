/**
 * phoneTools — the tool surface the on-device Gemma agent uses to control
 * other phone apps. Each tool maps to a method on the native PhoneControl
 * accessibility plugin. The model is instructed to emit JSON tool calls;
 * execPhoneTool() runs them and returns a serializable result.
 */

import { loadPhoneControl } from "./modelRegistry.js";

/** Canonical tool schemas exposed to the model. */
export const PHONE_TOOLS = [
  {
    name: "get_foreground",
    description:
      "Return the package and activity of the app currently in the foreground. Use this before acting to know where you are.",
    parameters: {},
  },
  {
    name: "read_screen",
    description:
      "Read the current screen and return its interactive elements (text, buttons, coordinates). Use this to understand the UI before tapping or typing.",
    parameters: {},
  },
  {
    name: "open_app",
    description:
      "Open a specific app by its Android package name (e.g. com.whatsapp, com.google.android.apps.maps).",
    parameters: { package_name: { type: "string", description: "Android package name to launch" } },
  },
  {
    name: "tap",
    description:
      "Tap an element. Provide `text` to tap the element whose visible text/description matches, or `x` and `y` for an exact coordinate.",
    parameters: {
      text: { type: "string", description: "Visible text (or content-desc) of the element to tap (optional)" },
      x: { type: "number", description: "Absolute x screen coordinate (optional if text given)" },
      y: { type: "number", description: "Absolute y screen coordinate (optional if text given)" },
    },
  },
  {
    name: "type",
    description:
      "Type text into the currently focused/editable field. Use only after the field is visible on screen.",
    parameters: { text: { type: "string", description: "Text to type" } },
  },
  {
    name: "press",
    description: "Press a system key or navigate.",
    parameters: {
      key: {
        type: "string",
        enum: ["back", "home", "recents", "notifications", "quick_settings"],
        description: "Which global action to perform",
      },
    },
  },
  {
    name: "swipe",
    description: "Swipe from one point to another on screen (e.g. scroll or dismiss).",
    parameters: {
      from_x: { type: "number", description: "Start x" },
      from_y: { type: "number", description: "Start y" },
      to_x: { type: "number", description: "End x" },
      to_y: { type: "number", description: "End y" },
      duration: { type: "number", description: "Duration in ms (default 300)" },
    },
  },
  {
    name: "capture_screenshot",
    description:
      "Capture a screenshot of the current screen and return a reference to the image file.",
    parameters: {},
  },
];

const TOOL_NAMES = new Set(PHONE_TOOLS.map((t) => t.name));

/** Tools that change other apps / send input — require user confirmation. */
const MUTATING_PHONE_TOOLS = new Set(["tap", "type", "open_app", "swipe", "press"]);

/** True if the name is one of the phone-control tools. */
export function isPhoneTool(name) {
  return TOOL_NAMES.has(name);
}

/** True if the tool mutates other apps (requires a confirmation gate). */
export function isMutatingPhoneTool(name) {
  return MUTATING_PHONE_TOOLS.has(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PACKAGE_ALIASES = {
  youtube: "com.google.android.youtube",
  gmail: "com.google.android.gm",
  calendar: "com.google.android.calendar",
  chrome: "com.android.chrome",
  maps: "com.google.android.apps.maps",
  drive: "com.google.android.apps.docs",
  files: "com.google.android.apps.nbu.files",
  calculator: "com.google.android.calculator",
  clock: "com.google.android.deskclock",
  notes: "com.samsung.android.app.notes",
  whatsapp: "com.whatsapp",
  telegram: "org.telegram.messenger",
  settings: "com.android.settings",
};

/** Normalize screen nodes into a compact list. */
function extractElements(screen, max = 50) {
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
    .filter((n) => n.text || n.editable)
    .slice(0, max);
}

/**
 * Find a clickable node on the current screen whose text or content-desc
 * contains the query (case-insensitive). Returns its center coordinates.
 */
async function findNodeByText(phone, text) {
  const screen = await phone.readScreen();
  const nodes = screen?.nodes ?? [];
  const query = String(text ?? "").trim().toLowerCase();
  if (!query) return null;

  // Exact or contains match, prioritizing clickable nodes. Only match when the
  // node's text contains the query — a reversed match (query includes node
  // text) can tap a near-empty node like "e" for "search youtube".
  const matches = nodes.filter((n) => {
    const t = (n.text || n.desc || "").toLowerCase();
    return t.includes(query);
  });

  const best =
    matches.find((n) => n.clickable === true) ||
    matches.find((n) => n.editable === true) ||
    matches[0];

  if (!best) return null;
  return { x: Math.round(best.x + (best.w || 40) / 2), y: Math.round(best.y + (best.h || 40) / 2) };
}

/**
 * Execute one phone tool call.
 * @param {string} name - tool name
 * @param {object} args - tool args
 * @param {object} [opts]
 * @param {object} [opts.phoneControl] - preloaded plugin instance
 * @param {Function} [opts.confirm] - async ({name,args,description}) => boolean;
 *   required for mutating tools (tap/type/open_app/swipe/press). Returning
 *   false declines the action before it touches the accessibility service.
 * @returns {Promise<object>} serializable result
 */
export async function execPhoneTool(name, args = {}, opts = {}) {
  const phone = opts.phoneControl ?? (await loadPhoneControl());
  if (!phone) {
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

  // Confirmation gate: block mutating actions until the user explicitly
  // approves (or the caller didn't wire a confirm — fail closed).
  if (MUTATING_PHONE_TOOLS.has(name)) {
    if (typeof opts.confirm !== "function") {
      return { ok: false, error: `${name} requires user confirmation`, declined: true };
    }
    const description = describeAction(name, args);
    const approved = await opts.confirm({ name, args, description });
    if (!approved) {
      return { ok: false, error: `action declined by user: ${description}`, declined: true };
    }
  }

  switch (name) {
    case "get_foreground": {
      const fg = await phone.getForegroundApp();
      return { ok: true, foreground_package: fg?.packageName ?? "", foreground_activity: fg?.className ?? "" };
    }
    case "read_screen": {
      const screen = await phone.readScreen();
      const nodes = extractElements(screen, 120);
      return { ok: true, foreground_package: screen?.foregroundPackage ?? "", elements: nodes };
    }
    case "open_app": {
      let pkg = String(args.package_name ?? args.app ?? "").trim();
      if (!pkg) return { ok: false, error: "package_name required" };
      const normalized = PACKAGE_ALIASES[pkg.toLowerCase()] || pkg;
      const res = await phone.openApp({ packageName: normalized });
      if (res?.ok === false) {
        return { ok: false, error: res?.error || `Could not open ${normalized}` };
      }
      await sleep(1200);
      let elements = [];
      try {
        const sc = await phone.readScreen();
        elements = extractElements(sc, 40);
      } catch {
        /* ignore */
      }
      return { ok: true, app: normalized, elements };
    }
    case "tap": {
      let target = null;
      if (args.text) target = await findNodeByText(phone, args.text);
      if (!target && args.x != null && args.y != null) {
        target = { x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) };
      }
      if (!target) {
        return { ok: false, error: `Could not find element "${args.text ?? "(coordinates)"}" on screen` };
      }
      const res = await phone.performTap({ x: target.x, y: target.y });
      await sleep(800);
      let elements = [];
      try {
        const sc = await phone.readScreen();
        elements = extractElements(sc, 30);
      } catch {
        /* ignore */
      }
      return { ok: res?.ok === true, tapped: target, elements };
    }
    case "type": {
      const text = String(args.text ?? "");
      if (!text) return { ok: false, error: "text required" };
      const res = await phone.inputText({ text });
      if (args.submit !== false && typeof phone.submitText === "function") {
        await phone.submitText().catch(() => {});
      }
      await sleep(800);
      let elements = [];
      try {
        const sc = await phone.readScreen();
        elements = extractElements(sc, 30);
      } catch {
        /* ignore */
      }
      return { ok: res?.ok === true, typed: text.slice(0, 200), elements };
    }
    case "press": {
      const key = String(args.key ?? "back");
      const valid = ["back", "home", "recents", "notifications", "quick_settings"];
      if (!valid.includes(key)) return { ok: false, error: `unknown key: ${key}` };
      const res = await phone.performGlobalAction({ action: key === "quick_settings" ? "quickSettings" : key });
      return { ok: res?.ok === true, action: key };
    }
    case "swipe": {
      const res = await phone.swipe({
        fromX: Math.round(Number(args.from_x ?? 0)),
        fromY: Math.round(Number(args.from_y ?? 0)),
        toX: Math.round(Number(args.to_x ?? 0)),
        toY: Math.round(Number(args.to_y ?? 0)),
        duration: Math.round(Number(args.duration ?? 300)),
      });
      return { ok: res?.ok === true };
    }
    case "capture_screenshot": {
      if (typeof phone.screenshot !== "function") {
        return { ok: false, error: "capture_screenshot requires native screenshot support" };
      }
      try {
        const res = await phone.screenshot();
        if (res?.ok === false) {
          return { ok: false, error: res.error || "screenshot failed" };
        }
        const field = ["data", "uri", "path", "fileUri"].find(
          (k) => typeof res?.[k] === "string" && res[k].length > 0
        );
        if (!field) {
          return { ok: false, error: "screenshot returned no data" };
        }
        return { ok: true, screenshot: res[field], mime: "image/png", source: field };
      } catch (err) {
        return { ok: false, error: err?.message ?? "screenshot failed" };
      }
    }
    default:
      return { ok: false, error: `unknown phone tool: ${name}` };
  }
}

/** Human-readable one-liner for a mutating phone action (shown in the confirm UI). */
export function describeAction(name, args = {}) {
  switch (name) {
    case "tap":
      if (args.text) return `Tap "${String(args.text).slice(0, 40)}"`;
      if (args.x != null && args.y != null) return `Tap at (${Math.round(Number(args.x))}, ${Math.round(Number(args.y))})`;
      return "Tap an element on screen";
    case "type":
      return `Type "${String(args.text ?? "").slice(0, 60)}"`;
    case "open_app":
      return `Open app "${String(args.package_name ?? "").slice(0, 40)}"`;
    case "swipe":
      return "Swipe on screen";
    case "press":
      return `Press ${String(args.key ?? "back")}`;
    default:
      return `${name} on this phone`;
  }
}
