/**
 * localChat — private, fully on-device chat + tool calling.
 *
 * Provider chain (all on-device, nothing leaves the phone):
 *   1. MediaPipe Gemma (.task bundle, GPU/NPU accelerated)
 *   2. Gemini Nano (Chrome Prompt API)
 *   3. WebLLM (WebGPU, runtime-loaded)
 *
 * Tool calling uses a JSON protocol the Gemma model is instructed to emit:
 *   {"tool":"<name>","args":{...}}
 * The loop executes the tool, feeds the result back as a user turn, and lets
 * the model produce the final answer (mirrors OnDeviceAI.chatGguf but wired
 * to the native MediaPipe runtime).
 */

import { loadMediaPipe } from "./modelRegistry.js";

/** Gemma chat-template markers used by the MediaPipe task bundles. */
const TURN_USER = "<start_of_turn>user";
const TURN_MODEL = "<start_of_turn>model";
const TURN_END = "<end_of_turn>";

/** Provider identifiers. */
export const PROVIDER = {
  MEDIAPIPE: "mediapipe",
  NANO: "nano",
  WEBLLM: "webllm",
  NONE: "none",
};

/**
 * Format messages + system prompt into a Gemma chat-template prompt.
 * @param {string} systemPrompt
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opts]
 * @param {boolean} [opts.includeModelTurn] - end with an open model turn
 * @returns {string}
 */
export function buildGemmaPrompt(systemPrompt, messages, { includeModelTurn = true } = {}) {
  const parts = [];
  if (systemPrompt) {
    parts.push(`${TURN_USER}\n${systemPrompt}${TURN_END}\n${TURN_MODEL}\nOK.`);
    parts.push(TURN_END);
  }
  for (const m of messages) {
    if (m.role === "user") {
      parts.push(`${TURN_USER}\n${m.content}${TURN_END}\n${TURN_MODEL}\n`);
    } else {
      parts.push(`${m.content}${TURN_END}\n`);
    }
  }
  if (includeModelTurn && (messages.length === 0 || messages[messages.length - 1]?.role !== "assistant")) {
    parts.push(`${TURN_MODEL}\n`);
  }
  return parts.join("\n");
}

/** Strip any leading model turn from a generated reply. */
export function cleanReply(reply) {
  let text = String(reply ?? "");
  text = text.replace(new RegExp(`^${TURN_END}`), "").trim();
  return text;
}

/**
 * Parse a Gemma tool call from a reply.
 * Accepts {"tool":"x","args":{...}} possibly wrapped in markdown fences.
 * @param {string} reply
 * @returns {{name:string,args:object}|null}
 */
export function parseToolCall(reply) {
  const text = String(reply ?? "");
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const tryParse = (s) => {
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed.tool === "string" && parsed.tool.trim()) {
        return { name: parsed.tool, args: parsed.args ?? {} };
      }
    } catch {
      /* not valid JSON */
    }
    return null;
  };

  const direct = tryParse(stripped);
  if (direct) return direct;

  // The model may wrap the JSON in prose — extract the balanced outer object.
  const idx = stripped.indexOf('"tool"');
  if (idx >= 0) {
    const start = stripped.lastIndexOf("{", idx);
    let depth = 0;
    let end = -1;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === "{") depth += 1;
      else if (stripped[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > start) {
      const extracted = tryParse(stripped.slice(start, end + 1));
      if (extracted) return extracted;
    }
  }
  return null;
}

/** Tool-calling system-prompt suffix describing the available tools. */
export function buildToolSchema(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  return (
    "\n\nYou can call tools to get things done. Available tools:\n" +
    JSON.stringify(tools) +
    "\n\nWhen you need a tool, respond with ONLY this JSON object (no other text): " +
    '{"tool":"<name>","args":{...}}. You will receive the tool result as the next user turn. ' +
    'When you have the answer, respond normally in plain text.'
  );
}

/**
 * One generation pass against the selected provider.
 * @returns {Promise<string>} full text
 */
async function generateOnce(provider, prompt, onChunk, { signal } = {}) {
  if (provider === PROVIDER.MEDIAPIPE) {
    const mp = await loadMediaPipe();
    if (!mp?.generate) throw new Error("MediaPipe runtime unavailable");
    const sessionId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let listener;
    let full = "";
    if (typeof onChunk === "function") {
      const handle = await mp.addListener("generate:progress", (data) => {
        if (data?.sessionId !== sessionId) return;
        if (data?.text) {
          full += data.text;
          onChunk(data.text);
        }
      });
      listener = handle;
    }
    const abort = () => {
      mp.cancel?.().catch?.(() => {});
    };
    try {
      const res = await mp.generate({ prompt, sessionId });
      const text = res?.text || full;
      onChunk?.(text.slice(full.length)); // flush any remainder
      return text;
    } finally {
      listener?.remove?.();
      signal?.removeEventListener?.("abort", abort);
    }
  }

  if (provider === PROVIDER.NANO) {
    const ai = await import("./OnDeviceAI.js");
    if (!(await ai.isAvailable())) throw new Error("Gemini Nano unavailable");
    return ai.generateStream(prompt, onChunk, { signal });
  }

  if (provider === PROVIDER.WEBLLM) {
    const ai = await import("./OnDeviceAI.js");
    return ai.chatWebLlm(prompt, { onChunk, modelKey: "smol" });
  }

  throw new Error("No local model provider available");
}

/**
 * Resolve the best available provider for a chat turn.
 * Never blocks indefinitely — falls back to NONE after a short probe window.
 * @returns {Promise<string>} PROVIDER.*
 */
export async function resolveProvider() {
  const probe = async () => {
    const mp = await loadMediaPipe();
    if (mp?.getStatus) {
      try {
        const status = await mp.getStatus();
        if (status?.modelLoaded) return PROVIDER.MEDIAPIPE;
      } catch {
        /* fall through */
      }
    }
    try {
      const ai = await import("./OnDeviceAI.js");
      if (await ai.isAvailable()) return PROVIDER.NANO;
      if (await ai.webllmAvailable()) return PROVIDER.WEBLLM;
    } catch {
      /* ignore */
    }
    return PROVIDER.NONE;
  };
  try {
    return await Promise.race([
      probe(),
      new Promise((resolve) => setTimeout(() => resolve(PROVIDER.NONE), 6000)),
    ]);
  } catch {
    return PROVIDER.NONE;
  }
}

/**
 * Private local chat with optional tool calling.
 *
 * @param {object} options
 * @param {string} options.userMessage - latest user message
 * @param {string} [options.systemPrompt]
 * @param {Array} [options.messages] - prior turns [{role,content}]
 * @param {string} [options.provider] - force a provider (PROVIDER.*)
 * @param {Array} [options.tools] - tool schemas [{name,description,parameters}]
 * @param {Function} [options.toolHandler] - async (name, args) => result
 * @param {Function} [options.onChunk] - streaming text callback
 * @param {Function} [options.onToolCall] - called when a tool is invoked
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxRounds] - max tool-call rounds (default 5)
 * @returns {Promise<{text:string,provider:string,toolCalls:Array}>}
 */
export async function chatLocal(options) {
  const {
    userMessage,
    systemPrompt = "",
    messages = [],
    provider,
    tools = [],
    toolHandler,
    onChunk,
    onToolCall,
    signal,
    maxRounds = 5,
  } = options;

  const effectiveProvider = provider ?? (await resolveProvider());
  if (effectiveProvider === PROVIDER.NONE) {
    return { text: "", provider: PROVIDER.NONE, toolCalls: [] };
  }

  const toolSchema = buildToolSchema(tools);
  const baseSystem = systemPrompt ? `${systemPrompt}${toolSchema}` : toolSchema;
  const history = [...messages, { role: "user", content: userMessage }];

  const toolCalls = [];
  let transcript = [...history];

  for (let round = 0; round < maxRounds; round++) {
    const prompt = buildGemmaPrompt(baseSystem, transcript, { includeModelTurn: true });
    const reply = cleanReply(await generateOnce(effectiveProvider, prompt, onChunk, { signal }));
    if (reply === "") return { text: "", provider: effectiveProvider, toolCalls };

    const toolCall = parseToolCall(reply);
    if (toolCall && typeof toolHandler === "function") {
      const result = await toolHandler(toolCall.name, toolCall.args).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
      toolCalls.push({ ...toolCall, result });
      onToolCall?.(toolCall, result);
      transcript = [
        ...transcript,
        { role: "assistant", content: reply },
        { role: "user", content: `Tool result: ${JSON.stringify(result)}` },
      ];
      continue;
    }

    return { text: reply, provider: effectiveProvider, toolCalls };
  }

  return { text: "", provider: effectiveProvider, toolCalls };
}

/** Convenience: plain private chat (no tools). */
export async function chatPrivate(userMessage, options = {}) {
  return chatLocal({ ...options, userMessage, tools: [] });
}
