/**
 * modelRegistry — unified local-model detection for Open-Chat.
 *
 * Sources (in priority order):
 *   1. On-device LiteRT-LM bundles (.litertlm files in app storage) — Qwen3.5,
 *      Gemma 4, etc. via the LiteRT-LM runtime (successor to MediaPipe).
 *   2. Chrome Prompt API / Gemini Nano
 *   3. WebLLM (WebGPU)
 *   4. OpenAI-compatible local servers (Ollama, LM Studio, llama.cpp, …)
 *
 * Every detected model normalizes to a `ModelEntry` so the Models screen
 * can render one consistent card list: name, kind, size, state, actions.
 *
 * Legacy note: MediaPipe LLM Inference was removed. `loadMediaPipe` /
 * `MEDIAPIPE_DEFAULT_MODELS` / `autoLoadMediaPipeModel` etc. remain as
 * deprecated aliases so older importers keep working — they now resolve the
 * LiteRT-LM runtime.
 */

import { scanLocalModels } from "./localModels.js";

/** Default LiteRT-LM bundles (downloaded on demand from HuggingFace). */
export const LITERT_DEFAULT_MODELS = [
  {
    id: "qwen3-5-4b",
    name: "Qwen3.5 4B",
    fileName: "Qwen3.5-4B_int8.litertlm",
    url: "https://huggingface.co/litert-community/Qwen3.5-4B/resolve/main/Qwen3.5-4B_int8.litertlm",
    sizeBytes: 4_102_000_000,
    kind: "ondevice",
    contextTokens: 4096,
    tagline: "Flagship · agentic + tool calling · 4.1 GB (12GB+ device)",
  },
  {
    id: "qwen3-5-0-8b",
    name: "Qwen3.5 0.8B",
    fileName: "Qwen3.5-0.8B_int8.litertlm",
    url: "https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/main/Qwen3.5-0.8B_int8.litertlm",
    sizeBytes: 978_000_000,
    kind: "ondevice",
    contextTokens: 4096,
    tagline: "Fast · ~978 MB · great on 8GB phones",
  },
  {
    id: "gemma4-e2b",
    name: "Gemma 4 E2B",
    fileName: "gemma-4-E2B-it.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
    sizeBytes: 2_583_000_000,
    kind: "ondevice",
    contextTokens: 2048,
    tagline: "Multimodal · native function tokens · Apache-2.0",
  },
];

/** Legacy alias for importers that haven't migrated yet. */
export const MEDIAPIPE_DEFAULT_MODELS = LITERT_DEFAULT_MODELS;

/** Model lifecycle states. */
export const MODEL_STATE = {
  NOT_INSTALLED: "not-installed",
  DOWNLOADING: "downloading",
  READY: "ready",
  LOADING: "loading",
  LOADED: "loaded",
  ERROR: "error",
};

/** Normalize a raw LiteRT-LM bundle record from the native plugin. */
export function litertBundleToEntry(bundle) {
  const known = LITERT_DEFAULT_MODELS.find((m) => m.fileName === bundle.fileName);
  return {
    id: known?.id ?? bundle.fileName,
    name: known?.name ?? bundle.fileName.replace(/\.(litertlm|task)$/, ""),
    fileName: bundle.fileName,
    url: known?.url ?? "",
    sizeBytes: bundle.sizeBytes ?? 0,
    kind: "ondevice",
    provider: "litertlm",
    contextTokens: known?.contextTokens,
    path: bundle.path ?? "",
    loaded: bundle.loaded === true,
    tagline: known?.tagline ?? "Local model bundle",
  };
}

/** Legacy alias. */
export const mediaPipeBundleToEntry = litertBundleToEntry;

const LITERT_METHODS = [
  "getStatus",
  "listModels",
  "downloadModel",
  "loadModel",
  "generate",
  "beginSession",
  "generateSession",
  "resetSession",
  "cancel",
  "unloadModel",
  "deleteModel",
  "addListener",
];

const PHONE_CONTROL_METHODS = [
  "getStatus",
  "listApps",
  "openAccessibilitySettings",
  "getForegroundApp",
  "readScreen",
  "performTap",
  "inputText",
  "submitText",
  "performGlobalAction",
  "openApp",
  "swipe",
  "screenshot",
];

const ONNX_IMAGE_GEN_METHODS = [
  "getStatus",
  "listModels",
  "downloadModel",
  "loadModel",
  "generate",
  "unloadModel",
  "deleteModel",
  "addListener",
];

function adapter(raw, methodNames) {
  /**
   * Wrap a Capacitor plugin proxy in a PLAIN object so async functions can
   * return it safely. The raw proxy is a thenable (its `.get` trap answers for
   * "then"), which makes the promise-resolution procedure call `.then()` on it
   * and throw "…plugin.then() is not implemented" — breaking every `await`.
   * @param {object} raw - Capacitor plugin proxy
   * @param {string[]} methodNames - method names to expose
   * @returns {object} plain adapter
   */
  const api = {};
  for (const name of methodNames) {
    const fn = raw?.[name];
    if (typeof fn === "function") api[name] = fn.bind(raw);
  }
  return api;
}

/**
 * Load the native LitertLm plugin safely (returns null off-device).
 * Prefers the already-registered Capacitor plugin (window.Capacitor.Plugins)
 * to avoid the runtime chunk-import path entirely; falls back to the module
 * import for web/tests. Always returns a plain adapter, never the proxy.
 * @returns {Promise<object|null>} plugin adapter or null
 */
export async function loadLitertLm() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const raw = cap?.Plugins?.LitertLm;
    const api = raw ? adapter(raw, LITERT_METHODS) : null;
    if (api && typeof api.getStatus === "function") return api;
  } catch {
    /* fall through to module import */
  }
  try {
    const mod = await import("@open-chat/litert-lm");
    const raw = mod?.default ?? mod?.LitertLm ?? null;
    const api = raw ? adapter(raw, LITERT_METHODS) : null;
    if (api && typeof api.getStatus === "function") return api;
    return null;
  } catch {
    return null;
  }
}

/** Deprecated alias — resolves the LiteRT-LM runtime (MediaPipe removed). */
export const loadMediaPipe = loadLitertLm;

/**
 * Load the native PhoneControl plugin safely (returns null off-device).
 */
export async function loadPhoneControl() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const raw = cap?.Plugins?.PhoneControl;
    const api = raw ? adapter(raw, PHONE_CONTROL_METHODS) : null;
    if (api && typeof api.getStatus === "function") return api;
  } catch {
    /* fall through to module import */
  }
  try {
    const mod = await import("@open-chat/phone-control");
    const raw = mod?.default ?? mod?.PhoneControl ?? null;
    const api = raw ? adapter(raw, PHONE_CONTROL_METHODS) : null;
    if (api && typeof api.getStatus === "function") return api;
    return null;
  } catch {
    return null;
  }
}

/**
 * Load the native OnnxImageGen plugin safely (returns null off-device).
 */
export async function loadOnnxImageGen() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const raw = cap?.Plugins?.OnnxImageGen;
    const api = raw ? adapter(raw, ONNX_IMAGE_GEN_METHODS) : null;
    if (api && typeof api.getStatus === "function") return api;
  } catch {
    /* fall through to module import */
  }
  try {
    const mod = await import("@open-chat/onnx-imagegen");
    const raw = mod?.default ?? mod?.OnnxImageGen ?? null;
    const api = raw ? adapter(raw, ONNX_IMAGE_GEN_METHODS) : null;
    if (api && typeof api.getStatus === "function") return api;
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect on-device LiteRT-LM bundles currently present in app storage.
 * @returns {Promise<ModelEntry[]>}
 */
export async function detectLitertLmBundles() {
  const rt = await loadLitertLm();
  if (!rt?.listModels) return [];
  try {
    const { models = [] } = await rt.listModels();
    return models.map(litertBundleToEntry);
  } catch {
    return [];
  }
}

/** Deprecated alias. */
export const detectMediaPipeBundles = detectLitertLmBundles;

/**
 * Preferred on-device backend ("cpu" | "gpu").
 *
 * CPU is the default: MediaPipe's GPU path has a known FP16 detokenizer bug
 * that emits garbled/repeated tokens on many devices (google-ai-edge/
 * mediapipe #5414 #5534 #6014, google-ai-edge/gallery #157). GPU is opt-in
 * via Settings; the chat loop auto-degrades to CPU if output corrupts.
 */
const BACKEND_KEY = "oc.llmBackend";

export function getPreferredBackend() {
  try {
    const v = localStorage.getItem(BACKEND_KEY);
    return v === "gpu" ? "gpu" : "cpu";
  } catch {
    return "cpu";
  }
}

export function setPreferredBackend(backend) {
  try {
    localStorage.setItem(BACKEND_KEY, backend === "gpu" ? "gpu" : "cpu");
  } catch {
    /* private mode etc. */
  }
}

/** Reload the currently loaded bundle with the given backend. */
export async function reloadLitertLmWithBackend(backend = getPreferredBackend()) {
  const rt = await loadLitertLm();
  if (!rt?.loadModel) return false;
  try {
    const status = await rt.getStatus();
    const fileName = String(status?.modelPath || "").split(/[\\/]/).pop();
    if (!fileName) return false;
    const res = await rt.loadModel({ fileName, backend });
    return res?.ok === true;
  } catch {
    return false;
  }
}

/** Deprecated alias. */
export const reloadMediaPipeWithBackend = reloadLitertLmWithBackend;

/**
 * Ensure an on-device LiteRT-LM bundle is loaded, loading the most recently
 * added bundle if none is currently loaded. This makes the "private local"
 * bot usable without a manual load step.
 * @returns {Promise<string|null>} the loaded model path, or null
 */
export async function autoLoadLitertLmModel() {
  const rt = await loadLitertLm();
  if (!rt?.listModels || !rt?.loadModel) return null;
  try {
    const status = await rt.getStatus();
    if (status?.modelLoaded) return status.modelPath || null;
  } catch {
    /* fall through to (re)load */
  }
  try {
    const { models = [] } = await rt.listModels();
    if (models.length === 0) return null;
    const bundle = models[0]; // native plugin sorts newest-first
    // Backend honors the user's Settings preference (default cpu).
    const res = await rt.loadModel({
      fileName: bundle.fileName,
      backend: getPreferredBackend(),
    });
    return res?.ok ? (res.modelPath || bundle.fileName) : null;
  } catch {
    return null;
  }
}

/** Deprecated alias. */
export const autoLoadMediaPipeModel = autoLoadLitertLmModel;

/** Full-model detection hard cap — scanning must always finish. */
const DETECT_TIMEOUT_MS = 8000;

/** Resolve after `ms`, rejecting if the inner promise is still pending. */
function withTimeout(promise, ms, tag) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${tag} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Full local-model detection across all sources.
 * @param {object} [opts]
 * @param {boolean} [opts.includeServers] - also probe localhost/LAN OpenAI servers
 * @param {string} [opts.extraHost] - LAN host to probe
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ sources: Array<{id:string,name:string,models:ModelEntry[]}> }>}
 */
export async function detectLocalModels({ includeServers = true, extraHost, signal } = {}) {
  return withTimeout(detectLocalModelsInner({ includeServers, extraHost, signal }), DETECT_TIMEOUT_MS, "model-scan");
}

async function detectLocalModelsInner({ includeServers, extraHost, signal }) {
  const sources = [];

  const ondevice = await detectLitertLmBundles();
  if (ondevice.length) {
    sources.push({ id: "ondevice", name: "On-device (LiteRT-LM)", models: ondevice });
  }

  // Gemini Nano / WebLLM availability (best-effort; OnDeviceAI caches checks)
  try {
    const ai = await import("./OnDeviceAI.js");
    const nano = await ai.isAvailable().catch(() => false);
    const webllm = await ai.webllmAvailable().catch(() => false);
    if (nano || webllm) {
      const models = [];
      if (nano) {
        models.push({
          id: "gemini-nano",
          name: "Gemini Nano",
          fileName: "gemini-nano",
          url: "",
          sizeBytes: 0,
          kind: "ondevice",
          provider: "nano",
          path: "",
          loaded: true,
          tagline: "Chrome built-in Prompt API",
        });
      }
      if (webllm) {
        models.push({
          id: "webllm",
          name: "WebLLM (WebGPU)",
          fileName: "webllm",
          url: "",
          sizeBytes: 0,
          kind: "ondevice",
          provider: "webllm",
          path: "",
          loaded: false,
          tagline: "Runtime-loaded via WebGPU",
        });
      }
      sources.push({ id: "system", name: "System runtimes", models });
    }
  } catch {
    /* ignore */
  }

  if (includeServers) {
    const servers = await scanLocalModels({ extraHost, signal }).catch(() => []);
    if (servers.length) {
      sources.push({
        id: "servers",
        name: "Local servers",
        models: servers.flatMap((s) =>
          s.models.map((modelId) => ({
            id: `${s.name}-${modelId}`,
            name: modelId,
            fileName: modelId,
            url: s.baseUrl,
            sizeBytes: 0,
            kind: "server",
            provider: "openai",
            path: s.baseUrl,
            loaded: true,
            tagline: `${s.name} · ${s.baseUrl}`,
          }))
        ),
      });
    }
  }

  return { sources };
}

/** Size formatter (bytes → human). */
export function formatBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const rounded = n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
  return `${rounded} ${units[i]}`;
}
