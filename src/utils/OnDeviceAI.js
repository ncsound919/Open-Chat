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
 * Fallback for devices without the Chrome Prompt API. Loads a small quantized
 * model on-device so Open-Chat can chat + voice-call with NO server.
 */

let _webLlm = null; // { engine, modelId }

const SMALL_MODELS = {
  "smol": "SmolLM2-135M-Instruct-q4f16_1-MLC",
  "llama3.2-1b": "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "qwen2.5-1.5b": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
};

/** Does this device support WebGPU + web-llm? */
export async function webllmAvailable() {
  try {
    if (!navigator.gpu) return false;
    const mod = await import("@mlc-ai/web-llm");
    return typeof mod.CreateMLCEngine === "function" || typeof mod === "object";
  } catch {
    return false;
  }
}

/** Load (or reuse) a local model. Returns the engine. */
export async function initWebLlm(modelKey = "smol", onProgress) {
  const modelId = SMALL_MODELS[modelKey] ?? SMALL_MODELS.smol;
  if (_webLlm?.engine && _webLlm.modelId === modelId) return _webLlm.engine;
  const mod = await import("@mlc-ai/web-llm");
  const engine = await mod.CreateMLCEngine(modelId, {
    initProgressCallback: (p) => {
      if (typeof onProgress === "function" && p) {
        onProgress(p.text || "");
      }
    },
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
    return await engine.chat.completions.create({
      messages, stream: true, stream_options: { include_usage: true },
    }, onChunk);
  }
  const reply = await engine.chat.completions.create({ messages });
  return reply.choices?.[0]?.message?.content ?? "";
}

/**
 * Unified local chat: Gemini Nano first, WebLLM fallback.
 * Returns { text, provider } where provider is "nan?" | "webllm" | null.
 */
export async function localChat(prompt, options = {}) {
  if (await isAvailable()) {
    try {
      const text = await generate(prompt, options);
      return { text, provider: "nano" };
    } catch { /* fall through to webllm */ }
  }
  if (await webllmAvailable()) {
    try {
      const text = await chatWebLlm(prompt, options);
      return { text, provider: "webllm" };
    } catch { /* fall through */ }
  }
  return { text: "", provider: null };
}
