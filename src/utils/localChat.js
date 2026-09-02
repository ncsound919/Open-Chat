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

import {
  loadMediaPipe,
  setPreferredBackend,
  reloadMediaPipeWithBackend,
} from "./modelRegistry.js";

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

/** Strip leading/trailing model-turn markers from a generated reply. */
export function cleanReply(reply) {
  let text = String(reply ?? "");
  const re = new RegExp(`(?:^${TURN_END}\\s*|\\s*${TURN_END}$)`, "g");
  text = text.replace(re, "").trim();
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

/**
 * Tool-calling system-prompt suffix describing the available tools.
 *
 * Formatting matters for small models: the JSON contract and concrete examples
 * are shown FIRST (recency + exemplars beat an abstract rule buried after a
 * wall of prose), and each tool is a one-line directory entry rather than a
 * full JSON dump. The rest of the system prompt must NOT demonstrate a
 * different call syntax (e.g. `tool(args)` or `tool {arg: ...}`) — mixed
 * styles make tiny models answer from memory instead of emitting a call.
 */
export function buildToolSchema(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";

  const directory = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const argHints = tools
    .filter(
      (t) =>
        t.parameters &&
        Object.keys(t.parameters).length > 0 &&
        !("type" in t.parameters)
    )
    .map((t) => `  ${t.name} arguments: ${Object.keys(t.parameters).join(", ")}`)
    .join("\n");

  return (
    "\n\n[TOOL CALLING]\n" +
    "You can call tools. When the user's request needs one (searching the web, " +
    "researching, opening or driving an app, reading the screen), reply with " +
    "ONLY a single JSON object — no markdown fences, no prose, no other text:\n" +
    '{"tool":"<name>","args":{...}}\n' +
    "You will receive the tool result as the next user turn; then answer using it.\n\n" +
    "Available tools:\n" +
    directory +
    (argHints ? `\n${argHints}` : "") +
    "\n\nExamples:\n" +
    '{"tool":"web_search","args":{"query":"latest iPhone reviews"}}\n' +
    '{"tool":"deep_research","args":{"query":"what causes the northern lights"}}\n' +
    '{"tool":"open_app","args":{"package_name":"com.whatsapp"}}\n\n' +
    "You MUST call a tool before answering when the request needs one — never " +
    "answer a search/research/action request from memory."
  );
}

/**
 * One generation pass against the selected provider.
 * @param {boolean} [opts.session] - MEDIAPIPE: append to the persistent session
 * @returns {Promise<string>} full text
 */
async function generateOnce(provider, prompt, onChunk, { signal, session = false } = {}) {
  if (provider === PROVIDER.MEDIAPIPE) {
    const mp = await loadMediaPipe();
    if (!mp?.generate) throw new Error("MediaPipe runtime unavailable");
    const sessionId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let listener;
    let full = "";
    // Watchdog: MediaPipe occasionally stalls mid-generation (native decode
    // hang). Two tiers — CPU prefill of a large prompt can legitimately take
    // minutes before the FIRST token, so allow a longer initial window;
    // once tokens are flowing, 60s of silence means a stall.
    const IDLE_TIMEOUT_MS = 60_000;
    const PREFILL_TIMEOUT_MS = 150_000;
    const TOTAL_TIMEOUT_MS = 420_000;
    let lastActivity = Date.now();
    const startedAt = lastActivity;
    const handle = await mp.addListener("generate:progress", (data) => {
      if (data?.sessionId !== sessionId) return;
      lastActivity = Date.now();
      if (data?.text) {
        full += data.text;
        onChunk?.(data.text);
      }
    });
    listener = handle;
    const abort = () => {
      mp.cancel?.().catch?.(() => {});
    };
    signal?.addEventListener?.("abort", abort);
    try {
      const call = { prompt, sessionId };
      let settled = false;
      let completed = false;
      const genPromise = session ? mp.generateSession(call) : mp.generate(call);
      const watchdog = (async () => {
        for (;;) {
          await new Promise((r) => setTimeout(r, 1000));
          if (settled) return;
          const now = Date.now();
          const quietFor = now - lastActivity;
          if (full === "") {
            // No token yet: judge against the prefill window.
            if (quietFor > PREFILL_TIMEOUT_MS) {
              throw new Error("generation stalled during prefill");
            }
          } else if (quietFor > IDLE_TIMEOUT_MS) {
            throw new Error(
              `generation stalled — no output for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s`
            );
          }
          if (now - startedAt > TOTAL_TIMEOUT_MS) {
            throw new Error("generation exceeded time limit");
          }
        }
      })();
      watchdog.catch(() => {}); // losing branch must never become unhandled
      try {
        const res = await Promise.race([genPromise, watchdog]).finally(() => {
          settled = true;
        });
        const text = res?.text || full;
        onChunk?.(text.slice(full.length)); // flush any remainder
        completed = true;
        return text;
      } finally {
        // Cancel the native job ONLY when it failed/stalled/aborted. On a
        // completed generation mp.cancel() could interrupt a CONCURRENT
        // generation on a shared plugin instance.
        if (!completed) abort();
      }
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
 * Race a native plugin call against a timeout. MediaPipe session teardown
 * (resetSession/close) can block while a cancelled generation unwinds —
 * without this the recovery path itself freezes and the reply never lands.
 */
function withTimeout(promise, ms, label = "native call") {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Best-effort native session op that can never hang the caller. */
async function tryNative(mp, method, ms = 5000) {
  if (typeof mp?.[method] !== "function") return false;
  try {
    await withTimeout(mp[method](), ms, method);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect MediaPipe degenerate output — the known GPU-detokenizer bug family
 * (google-ai-edge/mediapipe #5414, #5534, #6014: repeated single tokens like
 * "geory geory…"/"<bos><bos>…" or truncated digit fragments). Used to retry
 * generation on a fresh session instead of surfacing garbage to the user.
 */
export function looksDegenerate(reply) {
  const t = String(reply ?? "").trim();
  if (!t || t.length < 2) return false;
  const words = t.split(/\s+/);
  // Same token repeated 6+ times with nothing else present.
  if (words.length >= 6 && words.every((w) => w === words[0])) return true;
  // Pure special-token spam.
  if (/^(<bos>|<eos>|<end_of_turn>|<start_of_turn>[\s>])+$/i.test(t)) return true;
  return false;
}

/**
 * Sanitize a tool result before persisting it on the tool-call card: drop
 * binary blobs (base64 screenshot data URIs) and truncate very long strings
 * so history/message state never balloons. Keeps the object shape so callers
 * can still read fields like `result.error`.
 */
export function sanitizeToolResult(result) {
  if (typeof result === "string") {
    return result.length > 4000
      ? `${result.slice(0, 4000)}…[truncated]`
      : result;
  }
  if (result && typeof result === "object") {
    const copy = {};
    for (const [k, v] of Object.entries(result)) {
      if (typeof v === "string" && /^data:image\//i.test(v)) continue;
      if (typeof v === "string" && v.length > 4000) {
        copy[k] = `${v.slice(0, 4000)}…[truncated]`;
      } else {
        copy[k] = v;
      }
    }
    return copy;
  }
  return String(result ?? "");
}

/**
 * Bound a tool result to a short text string for feeding back to the model.
 * A full web_search result can carry a screenshot blob that blows past a
 * small model's context window — the follow-up generation then returns empty
 * (the on-device failure: tool runs, answer turn is "").
 */
export function toolResultToText(result) {
  const safe = sanitizeToolResult(result);
  const text = typeof safe === "string" ? safe : JSON.stringify(safe);
  return text.length > 2500 ? `${text.slice(0, 2500)}…[truncated]` : text;
}

/**
 * Generic tool-calling loop (NANO / WEBLLM / fallback). Rebuilds the full
 * prompt each round — used only when persistent sessions aren't available.
 */
async function genericChatLoop({ baseSystem, history, onChunk, onToolCall, toolHandler, signal, maxRounds, provider }) {
  const toolCalls = [];
  let transcript = [...history];
  let degenerateRetries = 0;
  for (let round = 0; round < maxRounds; round++) {
    const prompt = buildGemmaPrompt(baseSystem, transcript, { includeModelTurn: true });
    // Buffer each round's stream so tool-call JSON never leaks into the visible chat.
    let reply = cleanReply(await generateOnce(provider, prompt, null, { signal }));
    if (reply === "") return { text: "", provider, toolCalls };

    // Garbage-output guard: regenerate once on a fresh context before giving up.
    if (looksDegenerate(reply) && degenerateRetries < 1) {
      degenerateRetries++;
      round--;
      continue;
    }

    const toolCall = parseToolCall(reply);
    if (toolCall && typeof toolHandler === "function") {
      const result = await toolHandler(toolCall.name, toolCall.args).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
      const safeResult = sanitizeToolResult(result);
      toolCalls.push({ ...toolCall, result: safeResult });
      onToolCall?.(toolCall, safeResult);
      transcript = [
        ...transcript,
        { role: "assistant", content: reply },
        { role: "user", content: `Tool result: ${toolResultToText(result)}` },
      ];
      continue;
    }

    // Only the final, plain-text answer is shown.
    if (onChunk && reply) onChunk(reply);
    return { text: reply, provider, toolCalls };
  }
  return { text: "", provider, toolCalls };
}

/**
 * Persistent-session tool loop (MEDIAPIPE). Seeds the system prompt (and any
 * prior history) ONCE into a MediaPipe LlmInferenceSession, then feeds only
 * the incremental user turns each round. The model's own tool-call replies
 * stay in the session KV-cache, so the big system prompt is never reprocessed.
 */
async function mediaPipeChatLoop({ baseSystem, history, onChunk, onToolCall, toolHandler, signal, maxRounds }) {
  const provider = PROVIDER.MEDIAPIPE;
  const mp = await loadMediaPipe();
  const toolCalls = [];

  // Fall back to the generic full-prompt loop if the session API is missing.
  if (!mp?.beginSession || !mp?.generateSession) {
    return genericChatLoop({ baseSystem, history, onChunk, onToolCall, toolHandler, signal, maxRounds, provider });
  }

  // Seed system prompt + prior turns once; they live in the KV cache after
  // this. Cap the seeded history — tiny models lose track of which turn is
  // current when long transcripts are seeded (they answer OLD questions).
  const recentHistory = history.slice(0, -1).slice(-6);
  const seedPrompt = buildGemmaPrompt(baseSystem, recentHistory, { includeModelTurn: false });
  try {
    await withTimeout(mp.beginSession({ systemPrompt: seedPrompt }), 15000, "beginSession");
  } catch (e) {
    throw new Error(`Session init failed: ${e.message}`);
  }

  const feedUserTurn = (content) => `\n${TURN_USER}\n${content}${TURN_END}\n${TURN_MODEL}\n`;
  // Small models parrot context instead of answering. This directive rides
  // along with every tool result to force a final conversational answer.
  const ANSWER_NOW =
    "\n(Give your final answer to the user NOW based on this result, in one short friendly message. Do not repeat these instructions or the result text verbatim.)";
  let lastToolResult = null;
  let priorReply = null;
  let degenerateRetries = 0;

  for (let round = 0; round < maxRounds; round++) {
    const incremental = priorReply === null
      ? feedUserTurn(`Current request — answer THIS: ${history[history.length - 1].content}`)
      : feedUserTurn(`Tool result: ${toolResultToText(lastToolResult)}${ANSWER_NOW}`);
    let reply;
    try {
      // Buffer the round so tool-call JSON never leaks into the visible chat.
      reply = cleanReply(await generateOnce(provider, incremental, null, { signal, session: true }));
    } catch (e) {
      // The persistent session's context window filled (OUT_OF_RANGE), the
      // runtime errored, or the watchdog cancelled a stall. Reset (bounded —
      // native teardown can hang) and degrade to the full-prompt loop so the
      // task still completes.
      await tryNative(mp, "resetSession");
      return genericChatLoop({ baseSystem, history, onChunk, onToolCall, toolHandler, signal, maxRounds, provider });
    }
    if (reply === "") return { text: "", provider, toolCalls };

    // Garbage-output guard (GPU detokenizer bugs): strike 1 = reset the
    // whole session and regenerate. Strike 2 = the runtime itself is
    // corrupting output — persist CPU as the preferred backend, reload the
    // model on CPU, rebuild the session, and regenerate before answering.
    if (looksDegenerate(reply) && degenerateRetries < 2) {
      degenerateRetries++;
      let reseeded = false;
      await tryNative(mp, "resetSession");
      if (degenerateRetries >= 2) {
        setPreferredBackend("cpu");
        await reloadMediaPipeWithBackend("cpu").catch(() => false);
      }
      try {
        // beginSession needs the systemPrompt argument — bounded directly.
        await withTimeout(mp.beginSession({ systemPrompt: seedPrompt }), 8000, "beginSession");
        reseeded = true;
      } catch {
        /* keep going with whatever state we have */
      }
      lastToolResult = null;
      priorReply = null;
      if (reseeded) {
        round--;
        continue;
      }
    }

    const toolCall = parseToolCall(reply);
    if (toolCall && typeof toolHandler === "function") {
      const result = await toolHandler(toolCall.name, toolCall.args).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
      const safeResult = sanitizeToolResult(result);
      toolCalls.push({ ...toolCall, result: safeResult });
      onToolCall?.(toolCall, safeResult);
      lastToolResult = safeResult;
      priorReply = reply;
      continue;
    }

    // Only the final, plain-text answer is shown.
    if (onChunk && reply) onChunk(reply);
    return { text: reply, provider, toolCalls };
  }
  return { text: "", provider, toolCalls };
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

  if (effectiveProvider === PROVIDER.MEDIAPIPE) {
    return mediaPipeChatLoop({
      baseSystem,
      history,
      onChunk,
      onToolCall,
      toolHandler,
      signal,
      maxRounds,
    });
  }

  return genericChatLoop({
    baseSystem,
    history,
    onChunk,
    onToolCall,
    toolHandler,
    signal,
    maxRounds,
    provider: effectiveProvider,
  });
}

/** Convenience: plain private chat (no tools). */
export async function chatPrivate(userMessage, options = {}) {
  return chatLocal({ ...options, userMessage, tools: [] });
}
