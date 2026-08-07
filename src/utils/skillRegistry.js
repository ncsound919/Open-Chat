/**
 * On-device skill registry — lets the local model complete tasks on the phone.
 *
 * Shape: intent → handler map. Handlers fail-soft on web (no native plugins)
 * and wrap the plugins that ARE installed (@capacitor/local-notifications,
 * app, haptics, keyboard, network, preferences, status-bar). Skills that need
 * a plugin you haven't installed yet (share, clipboard, filesystem) return a
 * clear "needs plugin" message so the model can respond gracefully.
 *
 * Runtime note (Galaxy S25): this app does NOT use CDN llama-cpp-wasm —
 * models run native (MediaPipe LLM Inference / llama.cpp Vulkan via a thin
 * Capacitor bridge). See OnDeviceAI.js "runtime" for the provider chain.
 */

/**
 * Dynamic-import a Capacitor plugin by name using a VARIABLE specifier so
 * Vite cannot statically resolve/require it at build time. On web (no
 * native platform) this resolves to null; on device the plugin is installed.
 */
async function nativePlugin(name) {
  try {
    const mod = await import(name);
    const plugin = mod?.default ?? mod;
    return plugin;
  } catch {
    return null;
  }
}

async function isNative() {
  const core = await nativePlugin("@capacitor/core");
  return core?.Capacitor?.isNativePlatform?.() === true;
}

export const PHONE_SKILLS = [
  {
    name: "read_recap",
    description: "Read the latest Draymond phase recap aloud (morning|midday|evening|night).",
    async run(args, ctx) {
      const phase = ["morning", "midday", "evening", "night"].includes(args?.phase) ? args.phase : "evening";
      const url = ctx?.draymondUrl;
      if (!url) return { ok: false, result: "Draymond not configured" };
      try {
        const res = await fetch(`${url}/api/ops/communicator?phase=${phase}`, {
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return { ok: false, result: `recap HTTP ${res.status}` };
        const data = await res.json();
        const text = data?.recap?.summary || data?.markdown?.slice(0, 500) || "No recap available.";
        if (typeof ctx?.onSpeak === "function") ctx.onSpeak(text);
        return { ok: true, result: text };
      } catch (err) {
        return { ok: false, result: `recap unavailable: ${err.message}` };
      }
    },
  },
  {
    name: "open_app",
    description: "Open another app on the phone (e.g. WhatsApp, Messages, Camera) by package/bundle id.",
    async run(args) {
      const pkg = args?.app || args?.package;
      if (!pkg) return { ok: false, result: "no app specified" };
      if (!(await isNative())) return { ok: false, result: "open_app requires native (Android/iOS)" };
      try {
        // Intent-based launch via the Browser plugin's intent:// scheme.
        const Browser = await nativePlugin("@capacitor/browser");
        if (Browser?.Browser?.open) {
          await Browser.Browser.open({ url: `intent://#Intent;package=${pkg};end` });
          return { ok: true, result: `opened ${pkg}` };
        }
        return { ok: false, result: "browser plugin not installed" };
      } catch (err) {
        return { ok: false, result: err.message };
      }
    },
  },
  {
    name: "set_reminder",
    description: "Schedule a local notification reminder. args: { text, time } where time is an ISO string.",
    async run(args) {
      const text = String(args?.text ?? "Reminder");
      if (!args?.time) return { ok: false, result: "no time provided" };
      const when = new Date(args.time).getTime();
      if (Number.isNaN(when)) return { ok: false, result: "invalid time" };
      try {
        const { LocalNotifications } = await nativePlugin("@capacitor/local-notifications");
        if (!LocalNotifications) return { ok: false, result: "local-notifications plugin not installed" };
        await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 100000, title: "Open Chat", body: text, schedule: { at: new Date(when) } }] });
        return { ok: true, result: `reminder set for ${new Date(when).toLocaleString()}` };
      } catch (err) {
        return { ok: false, result: err.message };
      }
    },
  },
  {
    name: "read_notifications",
    description: "List pending local notifications (in-app). NOTE: reading OTHER apps' notifications requires the opt-in NotificationListener permission — not enabled by default.",
    async run() {
      try {
        const { LocalNotifications } = await nativePlugin("@capacitor/local-notifications");
        if (!LocalNotifications) return { ok: false, result: "local-notifications plugin not installed" };
        const { notifications } = await LocalNotifications.getPending();
        return { ok: true, result: `pending notifications: ${notifications.length}` };
      } catch (err) {
        return { ok: false, result: `notifications unavailable: ${err.message}` };
      }
    },
  },
  {
    name: "open_settings",
    description: "Open the in-app settings screen.",
    async run() {
      return { ok: true, result: "settings requested" };
    },
  },
  {
    name: "current_time",
    description: "Return the current date and time.",
    async run() {
      return { ok: true, result: new Date().toString() };
    },
  },
  {
    name: "send_to_chat",
    description: "Send a message into the current Open-Chat conversation.",
    async run(args, ctx) {
      if (typeof ctx?.onSend === "function") {
        ctx.onSend(String(args?.text ?? ""));
        return { ok: true, result: "message sent to chat" };
      }
      return { ok: false, result: "no chat send handler" };
    },
  },
  {
    name: "share_to",
    description: "Share text/content to another app via the share sheet. Requires @capacitor/share.",
    async run(args) {
      try {
        const Share = await nativePlugin("@capacitor/share");
        if (!Share) return { ok: false, result: "share plugin not installed — add @capacitor/share" };
        await Share.Share.share({ text: String(args?.content ?? ""), dialogTitle: args?.title ?? "Share" });
        return { ok: true, result: "shared" };
      } catch (err) {
        return { ok: false, result: err.message };
      }
    },
  },
];

export function skillList() {
  return PHONE_SKILLS.map((s) => ({ name: s.name, description: s.description }));
}

export async function runSkill(name, args, context = {}) {
  const skill = PHONE_SKILLS.find((s) => s.name === name);
  if (!skill) return { ok: false, result: `unknown skill: ${name}` };
  try {
    return await skill.run(args, context);
  } catch (err) {
    return { ok: false, result: err.message };
  }
}
