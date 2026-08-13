/**
 * galaxyAi — Galaxy AI skill pack.
 *
 * Samsung's Galaxy AI (Live Translate, Chat Assist, Summarize, Note Assist…)
 * is not a public API. It lives inside Samsung's own apps and is triggered
 * through their UIs. These skills therefore drive those apps with the
 * PhoneControl accessibility bridge: open the app, find and tap the AI
 * trigger, and read back the result. Gemma plans; this layer executes.
 */


import { loadPhoneControl } from "./modelRegistry.js";


/** Samsung app package names. */
export const SAMSUNG_APPS = {
  notes: "com.samsung.android.app.notes",
  messages: "com.samsung.android.messaging",
  internet: "com.sec.android.app.sbrowser",
  gallery: "com.sec.android.gallery3d",
  calendar: "com.samsung.android.calendar",
  keyboard: "com.samsung.android.honeyboard",
};

/** AI trigger labels Samsung surfaces in its apps (best-effort match). */
const AI_TRIGGER_PATTERNS = [
  /ai/i,
  /magic/i,
  /assist/i,
  /summari/i,
  /translate/i,
  /rewrite/i,
  /compose/i,
];

/**
 * Skill schemas exposed to the local Gemma agent.
 */
export const GALAXY_AI_SKILLS = [
  {
    name: "galaxy_open",
    description:
      "Open a Samsung app that has Galaxy AI built in (notes, messages, internet, gallery, calendar).",
    parameters: {
      app: {
        type: "string",
        enum: ["notes", "messages", "internet", "gallery", "calendar"],
        description: "Which Samsung app to open",
      },
    },
  },
  {
    name: "galaxy_ai_action",
    description:
      "Trigger a Galaxy AI action inside the current Samsung app (summarize, translate, rewrite, compose). Opens the app first, finds the AI button, taps it, and reads the result.",
    parameters: {
      app: {
        type: "string",
        enum: ["notes", "messages", "internet", "gallery", "calendar"],
        description: "Samsung app to use",
      },
      action: {
        type: "string",
        enum: ["summarize", "translate", "rewrite", "compose"],
        description: "Galaxy AI action to run",
      },
    },
  },
  {
    name: "galaxy_read_screen",
    description:
      "Read the visible text of the current screen. Use after a Galaxy AI action to capture its result.",
    parameters: {},
  },
];

const SKILL_NAMES = new Set(GALAXY_AI_SKILLS.map((s) => s.name));

/** True if the tool name is a Galaxy AI skill. */
export function isGalaxySkill(name) {
  return SKILL_NAMES.has(name);
}

/**
 * Find a clickable element on screen whose text or content-desc matches an
 * AI trigger pattern. Returns its center coordinates or null.
 */
function findAiTrigger(phone, screen) {
  const nodes = screen?.nodes ?? [];
  for (const node of nodes) {
    const haystack = `${node.text || ""} ${node.desc || ""}`.toLowerCase();
    if (node.clickable !== true) continue;
    if (AI_TRIGGER_PATTERNS.some((re) => re.test(haystack))) {
      return { x: Math.round(node.x + node.w / 2), y: Math.round(node.y + node.h / 2) };
    }
  }
  return null;
}

/**
 * Open a Samsung app (optionally after ensuring accessibility is enabled).
 */
async function openSamsungApp(phone, appKey) {
  const pkg = SAMSUNG_APPS[appKey];
  if (!pkg) return { ok: false, error: `unknown Samsung app: ${appKey}` };
  const res = await phone.openApp({ packageName: pkg });
  return { ok: res?.ok === true, app: appKey, packageName: pkg };
}

/**
 * Best-effort Galaxy AI flow:
 *   1. Open the Samsung app.
 *   2. Wait a moment, read the screen.
 *   3. Find the AI trigger and tap it.
 *   4. Read the screen again and return the visible result.
 */
async function runGalaxyAiAction(phone, appKey, action, waitMs = 2500) {
  const opened = await openSamsungApp(phone, appKey);
  if (!opened.ok) return opened;

  await new Promise((r) => setTimeout(r, waitMs));
  const screen = await phone.readScreen();
  const trigger = findAiTrigger(phone, screen);
  if (!trigger) {
    // Report what IS on screen so the agent can adapt.
    const labels = (screen?.nodes ?? [])
      .filter((n) => (n.text || n.desc) && n.clickable)
      .slice(0, 15)
      .map((n) => n.text || n.desc);
    return {
      ok: false,
      error: `No Galaxy AI button found in ${appKey}.`,
      action,
      visibleButtons: labels,
    };
  }

  await phone.performTap({ x: trigger.x, y: trigger.y });
  await new Promise((r) => setTimeout(r, waitMs));
  const after = await phone.readScreen();
  const text = (after?.nodes ?? [])
    .filter((n) => n.text && !n.clickable)
    .map((n) => n.text)
    .filter(Boolean)
    .slice(0, 40)
    .join("\n");
  return { ok: true, action, app: appKey, result: text.slice(0, 2000) };
}

/**
 * Execute a Galaxy AI skill.
 * @param {string} name - skill name
 * @param {object} args - skill args
 * @param {object} [opts]
 * @param {object} [opts.phoneControl] - preloaded plugin (loaded lazily if omitted)
 * @param {Function} [opts.confirm] - async ({name,args,description}) => boolean;
 *   required for mutating skills (galaxy_open, galaxy_ai_action).
 * @returns {Promise<object>}
 */
export async function execGalaxySkill(name, args = {}, opts = {}) {
  const phone = opts.phoneControl ?? (await loadPhoneControl());
  if (!phone) {
    return { ok: false, error: "PhoneControl plugin unavailable" };
  }
  const status = await phone.getStatus().catch(() => ({ enabled: false }));
  if (!status?.enabled) {
    return {
      ok: false,
      error:
        "Accessibility service is not enabled. Ask the user to enable 'Open Chat' in System Settings > Accessibility.",
      needs_enablement: true,
    };
  }

  // Confirmation gate: galaxy_open / galaxy_ai_action drive other apps.
  if (name === "galaxy_open" || name === "galaxy_ai_action") {
    if (typeof opts.confirm !== "function") {
      return { ok: false, error: `${name} requires user confirmation`, declined: true };
    }
    const description =
      name === "galaxy_open"
        ? `Open ${args.app ?? "Samsung"} app for Galaxy AI`
        : `Run Galaxy AI "${args.action ?? ""}" in ${args.app ?? "Samsung"}`;
    const approved = await opts.confirm({ name, args, description });
    if (!approved) {
      return { ok: false, error: `action declined by user: ${description}`, declined: true };
    }
  }

  switch (name) {
    case "galaxy_open": {
      const res = await openSamsungApp(phone, args.app);
      return res;
    }
    case "galaxy_ai_action": {
      return runGalaxyAiAction(phone, args.app, args.action);
    }
    case "galaxy_read_screen": {
      const screen = await phone.readScreen();
      const text = (screen?.nodes ?? [])
        .filter((n) => n.text && !n.clickable)
        .map((n) => n.text)
        .filter(Boolean)
        .slice(0, 60)
        .join("\n");
      return { ok: true, text: text.slice(0, 3000) };
    }
    default:
      return { ok: false, error: `unknown Galaxy AI skill: ${name}` };
  }
}
