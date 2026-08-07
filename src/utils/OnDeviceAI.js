/**
 * OnDeviceAI — Chrome Built-in Prompt API wrapper
 *
 * Uses window.ai.languageModel (Gemini Nano, available in Chrome on Android
 * when the "Prompt API for Gemini Nano" origin trial or flag is enabled).
 *
 * Docs: https://developer.chrome.com/docs/ai/built-in
 *
 * Availability:
 *   - Chrome 127+ on desktop (flag: #optimization-guide-on-device-model)
 *   - Chrome on Android with on-device model downloaded
 *   - NOT available in Firefox, Safari, or WebView
 *
 * Falls back gracefully — callers should check isAvailable() before use.
 */

/** Cached availability result after first check */
let _availabilityCache = null;

/**
 * Check whether the Chrome Prompt API is available on this device.
 * Returns "yes" | "after-download" | "no".
 *
 * "after-download" means the model exists but needs to be downloaded first —
 * Chrome will handle it automatically when you create a session.
 *
 * @returns {Promise<"yes"|"after-download"|"no">}
 */
export async function checkAvailability() {
  if (_availabilityCache !== null) return _availabilityCache;

  try {
    if (!window.ai?.languageModel?.capabilities) {
      _availabilityCache = "no";
      return "no";
    }

    const caps = await window.ai.languageModel.capabilities();
    const status = caps.available ?? "no";
    _availabilityCache = status === "readily" ? "yes"
      : status === "after-download" ? "after-download"
      : "no";
    return _availabilityCache;
  } catch {
    _availabilityCache = "no";
    return "no";
  }
}

/**
 * Convenience boolean check — returns true if the API is usable right now
 * (or will be usable after a background download Chrome initiates automatically).
 *
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  const status = await checkAvailability();
  return status === "yes" || status === "after-download";
}

/**
 * Generate an on-device completion using Gemini Nano.
 *
 * @param {string} prompt - The prompt to send to the model
 * @param {object} [options]
 * @param {string} [options.systemPrompt] - System-level instruction for the session
 * @param {number} [options.temperature] - Sampling temperature (0–1)
 * @param {number} [options.topK] - Top-K sampling parameter
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {Promise<string>} - The generated text
 * @throws {Error} if the API is unavailable or generation fails
 */
export async function generate(prompt, options = {}) {
  const { systemPrompt, temperature, topK, signal } = options;

  if (!(await isAvailable())) {
    throw new Error("On-device AI is not available on this device/browser.");
  }

  const sessionOptions = {};
  if (systemPrompt !== undefined) sessionOptions.systemPrompt = systemPrompt;
  if (temperature !== undefined) sessionOptions.temperature = temperature;
  if (topK !== undefined) sessionOptions.topK = topK;

  let session;
  try {
    session = await window.ai.languageModel.create(sessionOptions);
  } catch (err) {
    throw new Error(`Failed to create on-device AI session: ${err.message}`);
  }

  try {
    // promptStreaming exists but we collect the full result for simplicity;
    // callers that want streaming should use generateStream() below.
    const result = await session.prompt(prompt, signal ? { signal } : undefined);
    return result;
  } finally {
    session.destroy();
  }
}

/**
 * Stream an on-device completion using Gemini Nano.
 * Calls onChunk(text) for each incremental piece, then resolves with full text.
 *
 * @param {string} prompt - The prompt to send to the model
 * @param {Function} onChunk - Called with each text chunk as it arrives
 * @param {object} [options]
 * @param {string} [options.systemPrompt] - System-level instruction for the session
 * @param {number} [options.temperature] - Sampling temperature (0–1)
 * @param {number} [options.topK] - Top-K sampling parameter
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {Promise<string>} - The full generated text
 * @throws {Error} if the API is unavailable or generation fails
 */
export async function generateStream(prompt, onChunk, options = {}) {
  const { systemPrompt, temperature, topK, signal } = options;

  if (!(await isAvailable())) {
    throw new Error("On-device AI is not available on this device/browser.");
  }

  const sessionOptions = {};
  if (systemPrompt !== undefined) sessionOptions.systemPrompt = systemPrompt;
  if (temperature !== undefined) sessionOptions.temperature = temperature;
  if (topK !== undefined) sessionOptions.topK = topK;

  let session;
  try {
    session = await window.ai.languageModel.create(sessionOptions);
  } catch (err) {
    throw new Error(`Failed to create on-device AI session: ${err.message}`);
  }

  try {
    const stream = session.promptStreaming(
      prompt,
      signal ? { signal } : undefined
    );

    let previousLength = 0;
    let fullText = "";

    for await (const chunk of stream) {
      // The Prompt API returns the full accumulated text on each chunk,
      // so we slice off only the new part.
      const newPart = chunk.slice(previousLength);
      previousLength = chunk.length;
      fullText = chunk;
      if (newPart) onChunk(newPart);
    }

    return fullText;
  } finally {
    session.destroy();
  }
}

/**
 * Build the companion insight prompt for a Draymond response.
 * Keeps the model focused on adding value, not restating the answer.
 *
 * @param {string} draymondResponse - The text Draymond already sent
 * @param {string} userMessage - The original user message/task
 * @returns {string}
 */
export function buildInsightPrompt(draymondResponse, userMessage) {
  return `You are a helpful companion AI running privately on this device.

An AI orchestrator already gave this response to a user:

USER TASK:
${userMessage}

ORCHESTRATOR RESPONSE:
${draymondResponse}

Your job: add 2–4 brief, practical insights, tips, or relevant details that COMPLEMENT the response above — things not already covered. Be concise (under 120 words total). Use plain language. Do not restate what was already said. Format as short bullet points starting with "•".`;
}

/**
 * -- WebLLM provider (runs in the Capacitor WebView via WebGPU) -------------
 * Fallback for devices without the Chrome Prompt API. Loads the web-llm
 * library from a CDN at RUNTIME (not bundled) so the app + tests stay lean,
 * and the model runs fully on-device with no server.
 */

const WEBLLM_CDN = "https://unpkg.com/@mlc-ai/web-llm@0.2.84/lib/index.js";
const SMALL_MODELS = {
  "smol": "SmolLM2-135M-Instruct-q4f16_1-MLC",
  "llama3.2-1b": "Llama-3.2-1B-Instruct-q4f16_1-MLC",
};

let _webLlm = null; // { engine, modelId }

async function loadWebLlm() {
  if (typeof window !== "undefined" && window.__webLlmModule) return window.__webLlmModule;
  if (!navigator.gpu) throw new Error("WebGPU not available");
  const mod = await import(/* @vite-ignore */ WEBLLM_CDN);
  if (typeof window !== "undefined") window.__webLlmModule = mod;
  return mod;
}

/** Does this device support WebGPU + web-llm? */
export async function webllmAvailable() {
  try {
    await withTimeout(loadWebLlm(), 3000, "webllm-cdn");
    return true;
  } catch {
    return false;
  }
}

/** Load (or reuse) a local model. Returns the engine. */
export async function initWebLlm(modelKey = "smol", onProgress) {
  const modelId = SMALL_MODELS[modelKey] ?? SMALL_MODELS.smol;
  if (_webLlm?.engine && _webLlm.modelId === modelId) return _webLlm.engine;
  const mod = await loadWebLlm();
  const engine = await mod.CreateMLCEngine(modelId, {
    initProgressCallback: (p) => { if (typeof onProgress === "function" && p) onProgress(p.text || ""); },
  });
  _webLlm = { engine, modelId };
  return engine;
}

/** One-shot local chat via WebLLM. */
export async function chatWebLlm(prompt, options = {}) {
  const { systemPrompt, onChunk, modelKey } = options;
  const engine = await initWebLlm(modelKey);
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  if (typeof onChunk === "function") {
    return await engine.chat.completions.create({ messages, stream: true }, onChunk);
  }
  const reply = await engine.chat.completions.create({ messages });
  return reply.choices?.[0]?.message?.content ?? "";
}

/**
 * Unified local chat: Gemini Nano first, WebLLM fallback.
 * Returns { text, provider } where provider is "nano" | "webllm" | null.
 */
export async function localChat(prompt, options = {}) {
  if (await isAvailable()) {
    try {
      return { text: await generate(prompt, options), provider: "nano" };
    } catch { /* fall through */ }
  }
  if (await webllmAvailable()) {
    try {
      return { text: await chatWebLlm(prompt, options), provider: "webllm" };
    } catch { /* fall through */ }
  }
  return { text: "", provider: null };
}

/**
 * ── GGUF provider (Gemma 3 4B on-device, tool-calling + skills) ────────────
 * Runs GGUF models NATIVELY on the phone — NOT via CDN llama-cpp-wasm (WASM
 * has no GPU/NPU access and is far too slow for a 4B model in a WebView).
 * Provider chain:
 *   1. Native llama.cpp Capacitor bridge (`@capacitor/llama`, JNI + Vulkan)
 *   2. Google MediaPipe LLM Inference API (`@capacitor/mediapipe`, .task bundle)
 *   3. Desktop fallback: WebGPU WASM (dev only)
 * Tool calling uses Gemma 3's structured chat-template format (a JSON tool
 * call turn → execute → tool result turn → final answer).
 */

const GGUF_MODELS = {
  "gemma3-4b": "gemma-3-4b-it-Q4_K_M.gguf",
  "gemma3-1b": "gemma-3-1b-it-Q4_K_M.gguf",
};

let _gguf = null; // { runtime, session, modelKey }

/** Dynamic import by VARIABLE specifier so Vite can't statically resolve it. */
async function nativeModule(name) {
  try {
    return await import(name);
  } catch {
    return null;
  }
}

/** True when running inside the Capacitor native shell (phone). */
async function isNativeShell() {
  try {
    const core = await nativeModule("@capacitor/core");
    return core?.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** resolve after `ms` (rejects) unless the promise wins first. */
function withTimeout(promise, ms, tag) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${tag} timed out after ${ms}ms`)), ms)),
  ]);
}

async function loadGgufRuntime() {
  // 1) Native llama.cpp bridge (real GGUF + Vulkan) on the phone.
  const llama = await withTimeout(nativeModule("@capacitor/llama"), 2500, "llama-plugin");
  if (llama?.LLaMA) return { runtime: "native-llama", api: llama.LLaMA };
  // 2) MediaPipe LLM Inference (GPU-accelerated, official Gemma, .task bundle).
  const mp = await withTimeout(nativeModule("@capacitor/mediapipe"), 2500, "mediapipe-plugin");
  if (mp?.LLM) return { runtime: "mediapipe", api: mp.LLM };
  // 3) Desktop-dev WASM fallback — NEVER on the phone (a CDN fetch from a
  //    WebView can stall the renderer, and WASM is useless without GPU/NPU).
  if (await isNativeShell()) return { runtime: "none", api: null };
  const mod = await withTimeout(
    import(/* @vite-ignore */ "https://unpkg.com/@mlc-ai/llama-cpp-wasm"),
    3000,
    "wasm-cdn",
  );
  return { runtime: "wasm-dev", api: mod };
}

export async function ggufAvailable() {
  try {
    const r = await loadGgufRuntime();
    return r.runtime !== "none" && !!r.api;
  } catch {
    return false;
  }
}

/** Load a GGUF model (default Gemma 3 4B). Returns { runtime, api }. */
export async function initGguf(modelKey = "gemma3-4b", onProgress) {
  const ggufName = GGUF_MODELS[modelKey] ?? GGUF_MODELS["gemma3-1b"];
  if (_gguf?.modelKey === modelKey) return _gguf;
  const { runtime, api } = await loadGgufRuntime();
  if (runtime === "none" || !api) throw new Error("No native GGUF runtime available on this device.");
  let session;
  if (runtime === "native-llama") {
    session = await api.loadModel({ modelFileName: ggufName, contextSize: 4096, gpu: "vulkan" });
  } else if (runtime === "mediapipe") {
    const asset = await api.loadModelFromAssets(ggufName.replace(/\.gguf$/, ".task"));
    session = { runtime: "mediapipe", asset };
  } else {
    session = await api.createSession({
      modelFilePath: `https://huggingface.co/bartowski/gemma-3-4b-it-GGUF/resolve/main/${ggufName}`,
      contextSize: 4096,
      onLoadingProgress: (p) => { if (typeof onProgress === "function") onProgress(`gguf ${Math.round(p * 100)}%`); },
    });
  }
  _gguf = { modelKey, runtime, api, session };
  return _gguf;
}

/**
 * GGUF chat with STRUCTURED tool calling (Gemma chat-template JSON tool-call
 * turns). Loop: model returns a JSON tool call → execute → feed the result
 * back as a tool turn → model returns the final answer.
 * Returns { text, provider, toolCalls }.
 */
export async function chatGguf(prompt, options = {}) {
  const { systemPrompt, tools, toolHandler, modelKey, maxRounds = 4 } = options;
  const { runtime, api, session } = await initGguf(modelKey);
  const toolSchema = Array.isArray(tools) && tools.length
    ? `You can call tools. Available tools:\n${JSON.stringify(tools)}\n` +
      `When you need a tool, respond with ONLY a JSON object: {"tool":"<name>","args":{...}}. ` +
      `You will receive the result as the next user turn.`
    : "";
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: `${systemPrompt}\n${toolSchema}` });
  messages.push({ role: "user", content: prompt });

  const complete = async (turns) => {
    const transcript = turns.map((m) => `${m.role}: ${m.content}`).join("\n");
    if (runtime === "native-llama") return api.chat(session, turns);
    if (runtime === "mediapipe") return api.generateResponse(transcript);
    return session.prompt(transcript);
  };

  const toolCalls = [];
  for (let round = 0; round < maxRounds; round++) {
    const reply = String(await complete(messages)).trim();
    const toolCall = parseGemmaToolCall(reply);
    if (toolCall && typeof toolHandler === "function") {
      const result = await toolHandler(toolCall.name, toolCall.args);
      toolCalls.push({ ...toolCall, result });
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: `Tool result: ${JSON.stringify(result)}` });
      continue;
    }
    return { text: reply, provider: runtime, toolCalls };
  }
  return { text: "", provider: runtime, toolCalls };
}

/** Parse a Gemma-style JSON tool call: {"tool":"name","args":{...}} */
function parseGemmaToolCall(reply) {
  const match = reply.match(/\{\s*"tool"\s*:\s*"([^"]+)"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed.tool === "string") {
      return { name: parsed.tool, args: parsed.args ?? {} };
    }
  } catch { /* not valid JSON — treat as plain answer */ }
  return null;
}

/** Unified local chat with tool support: Nano / WebLLM / GGUF. */
export async function localChatWithTools(prompt, options = {}) {
  if (options.forceGguf) return chatGguf(prompt, options);
  if (await isAvailable()) {
    try { return { text: await generate(prompt, options), provider: "nano", toolCalls: [] }; }
    catch { /* fall through */ }
  }
  if (await webllmAvailable()) {
    try { return { text: await chatWebLlm(prompt, options), provider: "webllm", toolCalls: [] }; }
    catch { /* fall through */ }
  }
  if (await ggufAvailable()) return chatGguf(prompt, options);
  return { text: "", provider: null, toolCalls: [] };
}
