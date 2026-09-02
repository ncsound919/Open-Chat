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

/**
 * AI trigger labels Samsung surfaces in its apps. Real Galaxy AI entry points
 * are frequently icon-only buttons whose accessibility label carries the hint
 * ("Galaxy AI", "Writing assist", "Composer", …) — match desc AND text, and
 * also accept viewId fragments Samsung uses for its AI widgets.
 */
const AI_TRIGGER_PATTERNS = [
  /galaxy\s*ai/i,
  /\bai\b/i,
  /magic/i,
  /assist/i,
  /summari/i,
  /translate/i,
  /rewrite/i,
  /composer|compose/i,
  /writing\s*(tool|assist)?/i,
  /note\s*assist/i,
  /browsing\s*assist/i,
  /chat\s*assist/i,
  /live\s*translate/i,
  /interpreter/i,
  /sketch\s*to|photo\s*assist/i,
];

const AI_TRIGGER_VIEWIDS = /galaxy.?ai|ai.?button|writing_?assist|composer/i;

/** How long to wait for a Samsung app to render before giving up (ms). */
const APP_LAUNCH_TIMEOUT_MS = 8000;
/** How often to re-read the screen while waiting (ms). */
const POLL_INTERVAL_MS = 600;
/** Extra settle time after tapping an AI trigger (ms). */
const RESULT_WAIT_MS = 3500;

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
 * Find a clickable element on screen whose text, content-desc, or viewId
 * matches an AI trigger. Returns its center coordinates or null.
 * Prefers explicit Galaxy AI labels over generic /ai/ matches.
 */
function findAiTrigger(screen) {
  const nodes = screen?.nodes ?? [];
  const hits = [];
  for (const node of nodes) {
    if (node.clickable !== true) continue;
    const haystack = `${node.text || ""} ${node.desc || ""}`.toLowerCase();
    const viewId = String(node.viewId || "");
    if (AI_TRIGGER_VIEWIDS.test(viewId)) {
      hits.push({ node, rank: 0 });
      continue;
    }
    for (let i = 0; i < AI_TRIGGER_PATTERNS.length; i++) {
      if (AI_TRIGGER_PATTERNS[i].test(haystack)) {
        // "galaxy ai" (rank via pattern position) beats generic /ai/.
        hits.push({ node, rank: i });
        break;
      }
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.rank - b.rank);
  const best = hits[0].node;
  return { x: Math.round(best.x + best.w / 2), y: Math.round(best.y + best.h / 2) };
}

/** Poll readScreen until the app renders nodes (or the timeout elapses). */
async function waitForScreen(phone, { timeoutMs = APP_LAUNCH_TIMEOUT_MS, minNodes = 3 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await phone.readScreen();
      if ((last?.nodes ?? []).length >= minNodes) return last;
    } catch {
      /* retry until deadline */
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return last;
}

/** Extract readable text lines from a raw screen payload. */
function readableText(screen, { max = 40 } = {}) {
  return (screen?.nodes ?? [])
    .filter((n) => (n.text || n.desc) && !n.editable)
    .map((n) => n.text || n.desc)
    .filter(Boolean)
    .slice(0, max)
    .join("\n");
}

/**
 * Open a Samsung app (optionally after ensuring accessibility is enabled).
 */
async function openSamsungApp(phone, appKey) {
  const pkg = SAMSUNG_APPS[appKey];
  if (!pkg) return { ok: false, error: `unknown Samsung app: ${appKey}` };
  let res;
  try {
    res = await phone.openApp({ packageName: pkg });
  } catch (e) {
    return { ok: false, error: `openApp failed for ${appKey}: ${e?.message ?? e}` };
  }
  if (res?.ok === false) {
    return { ok: false, error: res?.error || `Could not open ${appKey} (${pkg})` };
  }
  return { ok: true, app: appKey, packageName: pkg };
}

/**
 * Best-effort Galaxy AI flow:
 *   1. Open the Samsung app.
 *   2. Poll until its UI renders (Samsung apps can take several seconds).
 *   3. Find the AI trigger and tap it.
 *   4. Poll again so on-device AI output has time to stream in.
 *   5. Read the screen and return the visible result.
 *
 * @param {object} [timing] - { appLaunchTimeoutMs, resultWaitMs } overrides
 */
async function runGalaxyAiAction(phone, appKey, action, timing = {}) {
  const launchTimeoutMs = Number(timing.appLaunchTimeoutMs) || APP_LAUNCH_TIMEOUT_MS;
  const waitMs = Number(timing.resultWaitMs) || RESULT_WAIT_MS;

  const opened = await openSamsungApp(phone, appKey);
  if (!opened.ok) return opened;

  const screen = await waitForScreen(phone, { timeoutMs: launchTimeoutMs });
  let trigger = findAiTrigger(screen);
  if (!trigger) {
    // Report what IS on screen so the agent can adapt.
    const labels = (screen?.nodes ?? [])
      .filter((n) => (n.text || n.desc) && n.clickable)
      .slice(0, 15)
      .map((n) => n.text || n.desc);
    // One retry after a short settle — some apps load the AI entry late.
    await new Promise((r) => setTimeout(r, waitMs));
    const retryScreen = await phone.readScreen().catch(() => null);
    const retryTrigger = findAiTrigger(retryScreen);
    if (!retryTrigger) {
      return {
        ok: false,
        error: `No Galaxy AI button found in ${appKey}.`,
        action,
        visibleButtons: labels.length
          ? labels
          : (retryScreen?.nodes ?? [])
              .filter((n) => (n.text || n.desc) && n.clickable)
              .slice(0, 15)
              .map((n) => n.text || n.desc),
        foregroundPackage: screen?.foregroundPackage ?? "",
      };
    }
    trigger = retryTrigger;
  }

  try {
    await phone.performTap({ x: trigger.x, y: trigger.y });
  } catch (e) {
    return { ok: false, error: `tap failed: ${e?.message ?? e}`, action, app: appKey };
  }

  // Poll for the result panel instead of a single fixed sleep — Galaxy AI
  // panels animate in and on-device generation keeps updating the screen.
  const deadline = Date.now() + waitMs + Math.min(2500, waitMs);
  let after = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    after = await phone.readScreen().catch(() => null);
    const text = readableText(after, { max: 40 });
    if (text && text.split("\n").length >= 2) break;
  }
  const result = readableText(after, { max: 40 });
  return {
    ok: true,
    action,
    app: appKey,
    foregroundPackage: after?.foregroundPackage ?? "",
    result: result.slice(0, 2000),
  };
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
      return runGalaxyAiAction(phone, args.app, args.action, {
        appLaunchTimeoutMs: opts.appLaunchTimeoutMs,
        resultWaitMs: opts.resultWaitMs,
      });
    }
    case "galaxy_read_screen": {
      const screen = await phone.readScreen();
      const text = readableText(screen, { max: 60 });
      return {
        ok: true,
        text: text.slice(0, 3000),
        foregroundPackage: screen?.foregroundPackage ?? "",
      };
    }
    default:
      return { ok: false, error: `unknown Galaxy AI skill: ${name}` };
  }
}
