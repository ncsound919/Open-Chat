/**
 * LocalModelClient — bot-protocol client for fully on-device chat.
 *
 * Wraps the localChat engine so the rest of the app treats a "local" bot
 * exactly like any other protocol bot: connect()/disconnect()/send(stream).
 */

import { chatLocal, resolveProvider, PROVIDER } from "../utils/localChat.js";
import { autoLoadMediaPipeModel } from "../utils/modelRegistry.js";
import { PHONE_TOOLS, execPhoneTool } from "../utils/phoneTools.js";
import { GALAXY_AI_SKILLS, execGalaxySkill } from "../utils/galaxyAi.js";
import { DEFAULT_LOCAL_SYSTEM_PROMPT } from "../utils/galaxyPlanning.js";
import { verifyOutput } from "../utils/verification.js";
import { discoverApps, buildAppContext } from "../utils/appRegistry.js";
import { DRAYMOND_TOOL_NAMES } from "../utils/draymondTools.js";

export const LOCAL_PROVIDER_HINTS = {
  auto: undefined,
  gemma_e4b: PROVIDER.MEDIAPIPE,
  gemma_e2b: PROVIDER.MEDIAPIPE,
  nano: PROVIDER.NANO,
  webllm: PROVIDER.WEBLLM,
};

/**
 * @param {object} bot - local bot config (model, systemPrompt, phoneToolsEnabled, verifyEnabled)
 * @param {object} [opts]
 */
export class LocalModelClient {
  constructor(bot, opts = {}) {
    this.bot = bot;
    this.model = bot.model ?? "auto";
    this.systemPrompt = bot.systemPrompt ?? DEFAULT_LOCAL_SYSTEM_PROMPT;
    this.phoneToolsEnabled = bot.phoneToolsEnabled !== false;
    this.galaxySkillsEnabled = bot.galaxySkillsEnabled !== false;
    this.verifyEnabled = bot.verifyEnabled === true;
    // Optional Draymond skill tools (schemas + handler injected by the app).
    this.draymondToolsEnabled = bot.draymondSkillsEnabled === true;
    this.draymondTools = Array.isArray(opts.draymondTools) ? opts.draymondTools : [];
    this.draymondToolHandler = opts.draymondToolHandler ?? null;
    this.status = "disconnected";
    this.onStatusChange = null;
    this.onToolCall = opts.onToolCall ?? null;
    this.onVerified = opts.onVerified ?? null;
    this.confirmAction = opts.confirmAction ?? null;
    this._abort = null;
    this._appsCache = null;
    this._appsCacheAt = 0;
  }

  /** Discover installed apps (cached ~60s) and build the app context section. */
  async _appContext() {
    if (this._appsCache && Date.now() - this._appsCacheAt < 60_000) return this._appsCache;
    try {
      const { apps } = await discoverApps({});
      this._appsCache = buildAppContext(apps);
      this._appsCacheAt = Date.now();
    } catch {
      this._appsCache = "";
    }
    return this._appsCache ?? "";
  }

  async connect() {
    // Health check: is a model actually usable? If a MediaPipe bundle is
    // downloaded but not yet loaded, load it automatically so the "private
    // local" bot works out of the box.
    try {
      let provider = await resolveProvider();
      if (provider === PROVIDER.NONE) {
        const loaded = await autoLoadMediaPipeModel();
        if (loaded) provider = await resolveProvider();
      }
      this.status = provider === PROVIDER.NONE ? "no-model" : "connected";
    } catch {
      this.status = "error";
    }
    this.onStatusChange?.(this.status);
    return this.status;
  }

  disconnect() {
    this._abort?.abort();
    this.status = "disconnected";
    this.onStatusChange?.("disconnected");
  }

  /**
   * Route a tool call to the right executor (phone tools vs Galaxy AI skills).
   */
  async _execTool(name, args) {
    const confirm = this.confirmAction;
    if (this.galaxySkillsEnabled && isGalaxySkillName(name)) {
      return execGalaxySkill(name, args, { confirm });
    }
    return execPhoneTool(name, args, { confirm });
  }

  /**
   * Send a message and stream the reply.
   * @param {string} text
   * @param {(delta:string)=>void} onChunk
   * @param {AbortSignal} [signal]
   * @param {Array} [prior] - prior turns [{role,content}] (excludes the current message)
   * @returns {Promise<string>} full reply
   */
  async send(text, onChunk, signal, prior = []) {
    const controller = new AbortController();
    this._abort = controller;
    const mergedSignal = signal && AbortSignal.any
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const tools = [];
    if (this.phoneToolsEnabled) tools.push(...PHONE_TOOLS);
    if (this.galaxySkillsEnabled) tools.push(...GALAXY_AI_SKILLS);
    if (this.draymondToolsEnabled && this.draymondTools.length > 0) {
      tools.push(...this.draymondTools);
    }

    // Append the discovered-app capability surface to the system prompt so
    // Gemma knows exactly what it can open and drive on this device.
    const appSection = this.phoneToolsEnabled ? await this._appContext() : "";
    const systemPrompt = appSection ? `${this.systemPrompt}\n\n${appSection}` : this.systemPrompt;

    const draymondToolHandler = this.draymondToolHandler;
    // DRAYMOND_TOOL_NAMES is exported as an array; wrap in a Set for O(1) .has().
    const draymondToolNameSet = new Set(DRAYMOND_TOOL_NAMES);
    const result = await chatLocal({
      userMessage: text,
      systemPrompt,
      messages: prior,
      provider: LOCAL_PROVIDER_HINTS[this.model],
      tools,
      toolHandler: async (name, args) => {
        if (draymondToolHandler && draymondToolNameSet.has(name)) {
          return draymondToolHandler(name, args);
        }
        return this._execTool(name, args);
      },
      onChunk,
      onToolCall: (call, resultValue) => this.onToolCall?.(call, resultValue),
      signal: mergedSignal,
    });

    // Optional verification layer (Gemini Nano cross-check with heuristic fallback).
    if (this.verifyEnabled && result.text) {
      const verdict = await verifyOutput({ task: text, output: result.text, signal: mergedSignal });
      this.onVerified?.(verdict);
    }

    return result.text;
  }
}

/** Local helper (avoids importing the schema just to check membership). */
function isGalaxySkillName(name) {
  return ["galaxy_open", "galaxy_ai_action", "galaxy_read_screen"].includes(name);
}
