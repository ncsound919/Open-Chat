/**
 * Local model discovery for Open-Chat.
 *
 * Scans for OpenAI-compatible local LLM servers (Ollama, LM Studio,
 * llama.cpp, MLC, KoboldCpp, vLLM, Jan, GPT4All) on the device's own
 * localhost and, optionally, a LAN host. Each detected server's `/v1/models`
 * list is fetched so the UI can offer concrete model IDs to chat with.
 */

const LOCAL_PROBES = [
  { name: "Ollama", host: "127.0.0.1", port: 11434 },
  { name: "LM Studio", host: "127.0.0.1", port: 1234 },
  { name: "llama.cpp", host: "127.0.0.1", port: 8080 },
  { name: "MLC LLM", host: "127.0.0.1", port: 8080 },
  { name: "vLLM", host: "127.0.0.1", port: 8000 },
  { name: "KoboldCpp", host: "127.0.0.1", port: 5001 },
  { name: "Jan", host: "127.0.0.1", port: 1337 },
  { name: "GPT4All", host: "127.0.0.1", port: 4891 },
  { name: "Ollama (LAN)", host: "192.168.1.100", port: 11434 },
];

const MODELS_TIMEOUT_MS = 2500;

/**
 * Fetch the model list from an OpenAI-compatible server.
 * @param {string} baseUrl e.g. "http://127.0.0.1:11434"
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string[]>}
 */
export async function fetchModels(baseUrl, { signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  const merged = signal ? AbortSignal.any?.( [signal, controller.signal] ) ?? controller.signal : controller.signal;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, { signal: merged });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const models = data?.data || data?.models || [];
    if (Array.isArray(models)) {
      return models
        .map((m) => (typeof m === "string" ? m : m?.id || m?.model))
        .filter(Boolean);
    }
    return [];
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

/**
 * Resolve a probe's host to a base URL. LAN probes only run when the user
 * opts in (we can't guess their subnet reliably).
 * @param {{host:string, port:number}} probe
 * @returns {string}
 */
export function probeBaseUrl(probe) {
  // localhost/LAN IPs are plain http; never guess https for them
  return `http://${probe.host}:${probe.port}`;
}

/**
 * Scan localhost (+ optional LAN host) for OpenAI-compatible model servers.
 * @param {object} [opts]
 * @param {string} [opts.extraHost] - LAN host to scan in addition to localhost
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{name:string, baseUrl:string, models:string[]}>>}
 */
export async function scanLocalModels({ extraHost, signal } = {}) {
  const probes = LOCAL_PROBES.filter((p) => p.host !== "192.168.1.100");
  if (extraHost && extraHost.trim()) {
    probes.push({ name: `${extraHost.trim()} (custom)`, host: extraHost.trim(), port: 11434 });
  }

  const results = [];
  await Promise.all(
    probes.map(async (probe) => {
      const baseUrl = probeBaseUrl(probe);
      const models = await fetchModels(baseUrl, { signal });
      if (models.length > 0) {
        results.push({ name: probe.name, baseUrl, models });
      }
    })
  );

  // Deduplicate by baseUrl (e.g. llama.cpp + MLC share port 8080)
  const seen = new Set();
  return results
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((r) => (seen.has(r.baseUrl) ? false : seen.add(r.baseUrl)));
}

/**
 * Build a chat-ready bot config from a discovered model server.
 * @param {{name:string, baseUrl:string, models:string[]}} server
 * @param {string} modelId
 * @returns {object} bot config with protocol 'hermes' (OpenAI-compatible)
 */
export function modelServerToBot(server, modelId) {
  const url = new URL(server.baseUrl);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return {
    id: `local-${server.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${modelId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}`,
    name: modelId,
    avatar: "🧠",
    color: "#a78bfa",
    tagline: `${server.name} · local model`,
    protocol: "hermes",
    host: url.hostname,
    port,
    token: "",
    model: modelId,
    avatarUrl: null,
    localModel: true,
  };
}
