/**
 * appRegistry — dynamic app discovery for Open-Chat.
 *
 * Open Chat can drive ANY installed, launchable app through the accessibility
 * bridge (open, read screen, tap, type). Instead of hardcoding packages, we
 * enumerate the phone's apps, categorize them by capability, and tell the
 * local Gemma agent what it can actually affect on THIS device.
 */

import { loadPhoneControl } from "./modelRegistry.js";

/** Capability categories + risk levels. */
export const APP_CATEGORIES = [
  { key: "messaging", label: "Messaging & social", risk: "medium", desc: "Read, tap, type, respond" },
  { key: "finance", label: "Finance & payments", risk: "high", desc: "Read-only unless user confirms" },
  { key: "ai", label: "AI assistants", risk: "medium", desc: "Open and read outputs" },
  { key: "productivity", label: "Productivity & docs", risk: "medium", desc: "Create, edit, organize" },
  { key: "media", label: "Media & creation", risk: "medium", desc: "Create and manage content" },
  { key: "transport", label: "Transport & maps", risk: "medium", desc: "Book and navigate" },
  { key: "shopping", label: "Shopping & marketplaces", risk: "medium", desc: "Browse and compare" },
  { key: "health", label: "Health & fitness", risk: "low", desc: "Track and log" },
  { key: "other", label: "Other", risk: "low", desc: "General" },
];

const CATEGORY_BY_KEY = Object.fromEntries(APP_CATEGORIES.map((c) => [c.key, c]));

/** Package/label → category rules (first match wins, checked against both). */
const CATEGORY_RULES = [
  { re: /(messenger|orca|katana|instagram|reddit|linkedin|textnow|chating|whatsapp|telegram|discord|grok|contactkeys|contacts)/i, category: "messaging" },
  { re: /(coinbase|paypal|venmo|squareup\.cash|cash\.app|sofi|okex|wallet|kikoff|chime|finance)/i, category: "finance" },
  { re: /(perplexity|comet|claude|deepseek|copilot|kimi|bixby|translate|language\.tailwind|chatgpt|gemini)/i, category: "ai" },
  { re: /(docs|word|office|calendar|reminder|email\.provider|nbu\.files|rarlab|wetransfer|zoom|teams|github|voicenote|find|sheets)/i, category: "productivity" },
  { re: /(suno|music|picsart|elven|musically|tiktok|capcut|vanced|player\.bear|photosgo|videos|magazines|flud)/i, category: "media" },
  { re: /(uber|lyft|maps|navigation)/i, category: "transport" },
  { re: /(temu|poseidon|aliexpress|craigslist|guideplus|bestplay)/i, category: "shopping" },
  { re: /(apps3pluspro|mybhn|fitness|health|samsung\.health)/i, category: "health" },
];

/** Classify a single app by package + label. */
export function categorizeApp(app) {
  const haystack = `${app.packageName} ${app.label}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(haystack)) return rule.category;
  }
  return "other";
}

/**
 * Discover installed launchable apps and categorize them.
 * @param {object} [opts] - { phoneControl } preloaded plugin
 * @returns {Promise<{apps:Array,byCategory:object,count:number,available:boolean}>}
 */
export async function discoverApps({ phoneControl } = {}) {
  const phone = phoneControl ?? (await loadPhoneControl());
  if (!phone?.listApps) return { apps: [], byCategory: {}, count: 0, available: false };
  let list = [];
  try {
    const { apps = [] } = await phone.listApps();
    list = apps;
  } catch {
    return { apps: [], byCategory: {}, count: 0, available: false };
  }
  const apps = list.map((a) => {
    const key = categorizeApp(a);
    return { packageName: a.packageName, label: a.label || a.packageName, category: key, risk: CATEGORY_BY_KEY[key]?.risk ?? "low" };
  });
  const byCategory = {};
  for (const app of apps) {
    (byCategory[app.category] ??= []).push(app);
  }
  return { apps, byCategory, count: apps.length, available: true };
}

/** Build a concise "APPS ON THIS PHONE" prompt section for the agent. */
export function buildAppContext(apps, { maxPerCategory = 12 } = {}) {
  if (!apps?.length) return "";
  const lines = ["APPS ON THIS PHONE — you can open these and read/tap/type inside them via open_app (use the exact package_name):"];
  for (const cat of APP_CATEGORIES) {
    const list = (apps.filter((a) => a.category === cat.key) || []).slice(0, maxPerCategory);
    if (!list.length) continue;
    lines.push(
      `${cat.label} [${cat.risk}]: ${list.map((a) => `${a.label} (${a.packageName})`).join(", ")}` +
      (apps.filter((a) => a.category === cat.key).length > maxPerCategory ? " …" : "")
    );
  }
  lines.push("Rules: finance apps are READ-ONLY unless the user explicitly confirms a payment. Never post or send without confirmation.");
  return lines.join("\n");
}

/** Short summary of the biggest capability buckets (for UI). */
export function summarizeCapabilities(apps) {
  const buckets = APP_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    risk: c.risk,
    count: apps.filter((a) => a.category === c.key).length,
  })).filter((b) => b.count > 0);
  return buckets;
}
