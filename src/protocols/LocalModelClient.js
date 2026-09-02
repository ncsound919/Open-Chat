/**
 * LocalModelClient — bot-protocol client for fully on-device chat.
 *
 * Wraps the localChat engine so the rest of the app treats a "local" bot
 * exactly like any other protocol bot: connect()/disconnect()/send(stream).
 */

import { chatLocal, resolveProvider, PROVIDER } from "../utils/localChat.js";
import { autoLoadMediaPipeModel } from "../utils/modelRegistry.js";
import { PHONE_TOOLS, execPhoneTool } from "../utils/phoneTools.js";
import { GALAXY_AI_SKILLS, execGalaxySkill, isGalaxySkill } from "../utils/galaxyAi.js";
import {
  READ_PAGE_TOOL,
  DEEP_RESEARCH_TOOL,
  deepResearch,
  execResearchTool,
  isResearchTool,
} from "../utils/researchTools.js";
import { NAVIGATE_TOOL, navigateTo } from "../utils/browserNavigate.js";
import {
  detectResearchIntent,
  buildGroundingSection,
  RESEARCH_FAILED_SECTION,
} from "../utils/researchIntent.js";
import { DEFAULT_LOCAL_SYSTEM_PROMPT } from "../utils/galaxyPlanning.js";
import { WEB_SEARCH_TOOL, webSearch } from "../utils/webSearch.js";
import { IMAGE_GEN_TOOL, generateImage } from "../utils/imageGen.js";
import {
  CLOUD_TOOLS,
  CLOUD_TOOL_NAMES,
  runCloudTool,
} from "../utils/cloudIntegrations.js";
import {
  RECIPE_TOOLS,
  RECIPE_NAMES,
  runRecipe,
} from "../utils/appRecipes.js";
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

/** System-prompt section telling the agent which integrations exist. */
const INTEGRATIONS_CONTEXT = [
  "INTEGRATIONS — these capabilities exist and you call them with the tool JSON contract:",
  "- web_search: search the web in Chrome for live, factual, or current information. Uses vision + accessibility to locate Chrome's address bar, changes the URL directly to suit the research query from whatever page is open, and returns verified page vision + snippets.",
  "- read_page: call this to inspect the page URL, title, layout vision summary, screenshot, and visible text for the currently open web page.",
  "- navigate: changes the browser address bar directly to a URL (verified) regardless of whatever page is already loaded. Captures vision layout and page text.",
  "- deep_research: for any research question, consults many sources at once (Wikipedia articles + search, DuckDuckGo, live Chrome search with vision) and returns an organized, attributed digest.",
  "- When web_search or deep_research returns facts, base your reply ENTIRELY on the returned search data. Do not guess or make up unverified answers.",
  "- If a research tool returns ok:false, an error, or empty results, say you could not verify sources and offer to retry. NEVER fill in an answer from memory when research was requested.",
  "- When driving phone apps, actively tap and type to deliver what the user requested, rather than stopping after just opening the app.",
].join("\n");

/** Extra integration lines shown only when cloud/recipe tools are enabled. */
const CLOUD_INTEGRATIONS_CONTEXT = [
  "- wikipedia_search(query): look up facts/background on Wikipedia (cloud, fast).",
  "- wikipedia_summary(title): get a short article intro.",
  "- news_headlines(topic or query): get recent headlines.",
  "- gmail_inbox / calendar_events / drive_browse: open the phone app and read the screen.",
  "- gemini_query(query) / youtube_search(query): open the app, ask/search, and read the result.",
].join("\n");

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
    // Deterministic auto-research: intercept research-style questions and
    // ground the answer in verified findings BEFORE the model generates.
    this.autoResearchEnabled = bot.autoResearchEnabled !== false;
    // Opt-in tool packs. Small models degrade past ~6 simultaneous tools
    // (see research notes), so only the core research/phone set is exposed
    // by default; image-gen, cloud integrations, and recipes are opt-in.
    this.imageGenEnabled = bot.imageGenEnabled === true;
    this.cloudToolsEnabled = bot.cloudToolsEnabled === true;
    this.recipesEnabled = bot.recipesEnabled === true;
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
    if (this.galaxySkillsEnabled && isGalaxySkill(name)) {
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
    if (this.phoneToolsEnabled) tools.push(WEB_SEARCH_TOOL);
    if (this.phoneToolsEnabled) tools.push(NAVIGATE_TOOL);
    if (this.phoneToolsEnabled) tools.push(READ_PAGE_TOOL, DEEP_RESEARCH_TOOL);
    if (this.imageGenEnabled && this.phoneToolsEnabled) tools.push(IMAGE_GEN_TOOL);
    if (this.cloudToolsEnabled) tools.push(...CLOUD_TOOLS);
    if (this.recipesEnabled) tools.push(...RECIPE_TOOLS);
    if (this.galaxySkillsEnabled) tools.push(...GALAXY_AI_SKILLS);
    if (this.draymondToolsEnabled && this.draymondTools.length > 0) {
      tools.push(...this.draymondTools);
    }

    // Append the discovered-app capability surface to the system prompt so
    // Gemma knows exactly what it can open and drive on this device.
    const appSection = this.phoneToolsEnabled ? await this._appContext() : "";
    const integrationSections = this.phoneToolsEnabled
      ? [
          INTEGRATIONS_CONTEXT,
          ...(this.cloudToolsEnabled || this.recipesEnabled ? [CLOUD_INTEGRATIONS_CONTEXT] : []),
        ]
      : [];

    // Deterministic research interception: small models often skip tool
    // calls and hallucinate summaries. If this message asks for research,
    // run deep_research HERE and inject verified findings as the only
    // permitted answer material.
    let grounding = "";
    if (this.phoneToolsEnabled && this.autoResearchEnabled) {
      const intent = detectResearchIntent(text);
      if (intent) {
        this.onToolCall?.(
          { name: "deep_research", args: { query: intent.query, auto: true } },
          { status: "running" }
        );
        const dr = await deepResearch({
          query: intent.query,
          kind: intent.kind || "stable",
          confirm: this.confirmAction,
        }).catch(() => null);
        grounding = dr?.ok
          ? buildGroundingSection(dr)
          : RESEARCH_FAILED_SECTION;
        this.onToolCall?.(
          { name: "deep_research", args: { query: intent.query, auto: true } },
          dr?.ok
            ? { ok: true, sourcesUsed: dr.sourcesUsed, findingsCount: dr.findingsCount }
            : { ok: false }
        );
      }
    }

    const systemPrompt = [this.systemPrompt, appSection, ...integrationSections, grounding]
      .filter(Boolean)
      .join("\n\n");

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
        if (name === "web_search") {
          return webSearch({ query: String(args?.query ?? args?.q ?? ""), confirm: this.confirmAction });
        }
        if (name === "navigate") {
          return navigateTo({ url: String(args?.url ?? args?.site ?? "") });
        }
        if (isResearchTool(name)) {
          return execResearchTool(name, args, { confirm: this.confirmAction });
        }
        if (name === "image_gen") {
          return generateImage({ prompt: String(args?.prompt ?? "") });
        }
        if (CLOUD_TOOL_NAMES.has(name)) {
          return runCloudTool(name, args);
        }
        if (RECIPE_NAMES.has(name)) {
          return runRecipe(name, args, { confirm: this.confirmAction });
        }
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
