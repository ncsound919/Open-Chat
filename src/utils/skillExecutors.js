/**
 * skillExecutors — the tool-handler map injected into SkillPackRuntime so the
 * on-device worker can actually execute a Draymond skill pack's declared tools.
 *
 * Each key is a tool name (the pack's `tools` array entry) → async (context)
 * → serializable output. The context passed in is the task payload merged with
 * the injected `pack` and `tool` keys. Unknown/unavailable tools fail soft with
 * a clear, serializable reason — the runtime collects them in `failed` and the
 * worker still reports partial output back to Draymond.
 *
 * `buildSkillExecutors({ onSend, onNotify, chat })` lets callers inject
 * side effects: onSend posts a message into the active chat, onNotify fires a
 * local notification, and chat runs the on-device model (used by the
 * text/llm/summarize tools). Tests substitute fakes for all three.
 */

import { PHONE_TOOLS, execPhoneTool } from "./phoneTools.js";
import { runSkill } from "./skillRegistry.js";
import { discoverApps } from "./appRegistry.js";
import { webSearch } from "./webSearch.js";
import { generateImage } from "./imageGen.js";

/** Strip the runtime-injected reserved keys from a tool call's args. */
function toolArgs(ctx) {
  const args = { ...(ctx ?? {}) };
  delete args.pack;
  delete args.tool;
  return args;
}

/**
 * @param {object} [deps]
 * @param {(text:string)=>void} [deps.onSend] - post text into the active chat
 * @param {(title:string, body:string)=>Promise<unknown>} [deps.onNotify]
 * @param {(prompt:string, opts?:object)=>Promise<{text:string,provider?:string}>} [deps.chat] - on-device chat
 * @param {(req:object)=>Promise<boolean>} [deps.confirm] - user confirmation gate
 *   for mutating phone tools (tap/type/open_app/swipe/press).
 * @param {string} [deps.draymondBaseUrl] - Draymond base URL (no /api) for
 *   capture-to-SMD uploads and queue review.
 * @param {string} [deps.token] - Draymond Bearer token.
 * @returns {Record<string, (ctx:object)=>Promise<object>>}
 */
export function buildSkillExecutors({ onSend, onNotify, chat, confirm, draymondBaseUrl = "", token = "" } = {}) {
  const phone = (name, ctx) => execPhoneTool(name, toolArgs(ctx), { ...ctx, confirm });

  /** Upload a phone screenshot (base64) to the SMD media store via Draymond. */
  const captureToSmd = async (ctx) => {
    const args = toolArgs(ctx);
    // The pack may run capture_to_smd right after capture — if no data was
    // passed in args, pull the screenshot from the prior capture output in the
    // pack execution context (ctx.output.capture.screenshot).
    const priorCapture = ctx?.output?.capture ?? ctx?.output?.capture_screenshot ?? null;
    const b64 =
      args.data ??
      args.base64 ??
      (typeof priorCapture?.screenshot === "string" ? priorCapture.screenshot : "");
    if (!b64 || !draymondBaseUrl) {
      return { ok: false, error: "capture_to_smd requires screenshot data + a Draymond connection" };
    }
    try {
      const res = await fetch(`${draymondBaseUrl.replace(/\/+$/, "")}/api/v1/marketing/media`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          filename: args.filename ?? `capture-${Date.now()}.png`,
          data: b64,
          mime: args.mime ?? priorCapture?.mime ?? "image/png",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok !== true) {
        return { ok: false, error: json.error ?? `HTTP ${res.status}` };
      }
      return { ok: true, smd_ref: json.path, filename: json.filename };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  /** Pull the SMD publish queue for human review. */
  const smdQueue = async () => {
    if (!draymondBaseUrl) {
      return { ok: false, error: "smd_queue requires a Draymond connection" };
    }
    try {
      const res = await fetch(`${draymondBaseUrl.replace(/\/+$/, "")}/api/v1/marketing/queue`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok !== true) {
        return { ok: false, error: json.error ?? `HTTP ${res.status}` };
      }
      return { ok: true, total: json.total ?? 0, queue: json.queue ?? [] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };


  const textTool = async (ctx) => {
    const args = toolArgs(ctx);
    const prompt =
      args.prompt ?? args.text ?? args.content ?? ctx?.pack?.instructions ?? "";
    if (!prompt) return { ok: false, error: "no prompt/text provided" };
    if (typeof chat !== "function") {
      return { ok: false, error: "on-device model unavailable" };
    }
    try {
      const res = await chat(prompt, { maxRounds: 0 });
      return {
        ok: !!res?.text && res.text.length > 0,
        output: res?.text ?? "",
        provider: res?.provider ?? "local",
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const capture = async (ctx) => {
    const res = await phone("capture_screenshot", ctx);
    return res;
  };

  const phoneControl = async (ctx) => {
    // Composite "phone_control" tool: report where the phone is + screen summary.
    const fg = await phone("get_foreground", ctx).catch(() => ({ ok: false, error: "unavailable" }));
    const screen = await phone("read_screen", ctx).catch(() => ({ ok: false, error: "unavailable" }));
    return {
      ok: fg.ok === true || screen.ok === true,
      foreground: fg.foreground_package ?? "",
      elements: Array.isArray(screen.elements) ? screen.elements.slice(0, 20) : [],
    };
  };

  const aiApps = async () => {
    try {
      const { apps } = await discoverApps({});
      const names = (apps ?? [])
        .map((a) => a?.name || a?.packageName || "")
        .filter(Boolean)
        .slice(0, 25);
      return { ok: true, apps: names };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const notify = async (ctx) => {
    const args = toolArgs(ctx);
    const title = args.title ?? ctx?.pack?.name ?? "Open Chat";
    const body = args.body ?? args.message ?? args.text ?? "";
    if (typeof onNotify === "function") {
      await onNotify(title, body).catch(() => {});
      return { ok: true, notified: { title, body: body.slice(0, 200) } };
    }
    return { ok: true, notified: { title, body: body.slice(0, 200) }, source: "in-app" };
  };

  return {
    // Individual phone tools (PHONE_TOOLS names) + composite names the seed
    // packs reference.
    get_foreground: (ctx) => phone("get_foreground", ctx),
    read_screen: (ctx) => phone("read_screen", ctx),
    open_app: (ctx) => phone("open_app", ctx),
    tap: (ctx) => phone("tap", ctx),
    type: (ctx) => phone("type", ctx),
    press: (ctx) => phone("press", ctx),
    swipe: (ctx) => phone("swipe", ctx),
    capture_screenshot: capture,
    capture,
    phone_control: phoneControl,
    ai_apps: aiApps,
    capture_to_smd: captureToSmd,
    smd_queue: smdQueue,
    outputs: async (ctx) => ({ ok: true, outputs: ctx?.pack?.outputs ?? [] }),
    text: textTool,
    llm: textTool,
    summarize: textTool,
    notify,

    // On-device phone skills (skillRegistry PHONE_SKILLS).
    read_recap: (ctx) => runSkill("read_recap", toolArgs(ctx), { ...toolArgs(ctx), onSpeak: onSend, onSend }),
    set_reminder: (ctx) => runSkill("set_reminder", toolArgs(ctx)),
    read_notifications: () => runSkill("read_notifications", {}),
    current_time: () => runSkill("current_time", {}),
    share_to: (ctx) => runSkill("share_to", toolArgs(ctx)),
    send_to_chat: (ctx) => {
      const args = toolArgs(ctx);
      if (typeof onSend === "function") {
        onSend(String(args.text ?? args.message ?? ""));
        return Promise.resolve({ ok: true, result: "message sent to chat" });
      }
      return Promise.resolve({ ok: false, error: "no chat send handler" });
    },

    // Explicitly unavailable tools → clear soft failures (worker reports them).
    email: async () => ({ ok: false, error: "email tool is not available on this device" }),
    web: async (ctx) => {
      const args = toolArgs(ctx);
      const query = args.query ?? args.q ?? args.text ?? "";
      return webSearch({ query: String(query), confirm });
    },
    image_gen: async (ctx) => {
      const args = toolArgs(ctx);
      return generateImage({ prompt: String(args.prompt ?? args.text ?? "") });
    },
    registry: async () => ({ ok: false, error: "registry tool is not available on this device" }),
  };
}

/** All phone tool names, for runtime membership checks. */
export const PHONE_TOOL_NAMES = PHONE_TOOLS.map((t) => t.name);
