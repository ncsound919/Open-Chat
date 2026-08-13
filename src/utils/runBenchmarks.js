/**
 * runBenchmarks — runs the on-device benchmark + skill-test suite in-app.
 *
 * Measures:
 *  - model: load time + generation latency/tokens-per-second
 *  - skills: Galaxy AI skills + phone-control tools (live, needs accessibility)
 *  - verification: Gemini Nano/heuristic verify latency
 *
 * Returns a structured result set suitable for syncBenchmarksToDraymond.
 */

import { loadMediaPipe, loadPhoneControl } from "./modelRegistry.js";
import { execPhoneTool } from "./phoneTools.js";
import { execGalaxySkill } from "./galaxyAi.js";
import { verifyOutput } from "./verification.js";
import { buildAgentSystemPrompt } from "./galaxyPlanning.js";
import { timeAsync, estimateTokens, makeRunId, nowIso } from "./benchmarks.js";

const GEN_PROMPT =
  "Write a short paragraph about how on-device AI keeps your data private. Keep it under 80 words.";
const GEN_ROUNDS = 3;

function result(slug, name, metrics, extra = {}) {
  return { slug, name, metrics, ...extra };
}

/** Benchmark model load + generation. */
async function benchModel(mp, modelFile, backend) {
  const out = [];
  if (!mp) {
    out.push(result("local.model.load", "Model load", {}, { weakness_score: 100, evidence: "no mediapipe runtime" }));
    return out;
  }

  const load = await timeAsync(() =>
    mp.loadModel({ fileName: modelFile, maxTokens: 2048, topK: 40, backend })
  );
  out.push(
    result("local.model.load", `Model load (${modelFile.split("/").pop()})`, {
      load_ms: load.ms,
      ok: !load.error,
      backend,
    }, { weakness_score: 0, evidence: load.error ?? `ok in ${load.ms}ms` })
  );

  if (load.error || !load.value?.ok) return out;

  const genTimes = [];
  let totalTokens = 0;
  let totalMs = 0;
  for (let i = 0; i < GEN_ROUNDS; i++) {
    const gen = await timeAsync(async () => {
      let text = "";
      const sessionId = `bench-${Date.now()}-${i}`;
      let listener;
      const handle = await mp.addListener("generate:progress", (d) => {
        if (d?.sessionId === sessionId && d?.text) text += d.text;
      });
      listener = handle;
      try {
        const res = await mp.generate({ prompt: GEN_PROMPT, sessionId });
        return res?.text || text;
      } finally {
        listener?.remove?.();
      }
    });
    if (!gen.error && gen.value) {
      genTimes.push(gen.ms);
      totalMs += gen.ms;
      totalTokens += estimateTokens(gen.value);
    }
  }

  const avgMs = genTimes.length ? Math.round(genTimes.reduce((a, b) => a + b, 0) / genTimes.length) : 0;
  out.push(
    result("local.model.generate", "Generation (3 rounds)", {
      rounds: genTimes.length,
      avg_ms: avgMs,
      total_tokens: totalTokens,
      tokens_per_sec: totalMs > 0 ? Math.round((totalTokens / totalMs) * 1000) : 0,
      ok: genTimes.length === GEN_ROUNDS,
    }, { weakness_score: genTimes.length === GEN_ROUNDS ? 0 : 40, evidence: genTimes.join(",") || "no generations" })
  );

  return out;
}

/** Benchmark each phone-control tool with a safe invocation. */
async function benchPhoneTools(phone) {
  const out = [];
  if (!phone) return out;
  const cases = [
    ["get_foreground", {}],
    ["galaxy_read_screen", {}],
    ["read_screen", {}],
  ];
  for (const [name, args] of cases) {
    const t = await timeAsync(() => execPhoneTool(name, args, { phoneControl: phone, confirm: async () => true }));
    out.push(
      result(`tool.${name}`, `Tool: ${name}`, {
        ms: t.ms,
        ok: !t.error && t.value?.ok !== false,
      }, { weakness_score: t.error ? 60 : 0, evidence: t.error ?? `${t.ms}ms` })
    );
  }
  return out;
}

/** Benchmark Galaxy AI skills (live; requires accessibility). */
async function benchGalaxySkills(phone) {
  const out = [];
  if (!phone) return out;
  const cases = [
    ["galaxy_open", { app: "notes" }],
    ["galaxy_read_screen", {}],
    ["galaxy_ai_action", { app: "notes", action: "summarize" }],
  ];
  for (const [name, args] of cases) {
    const t = await timeAsync(() => execGalaxySkill(name, args, { phoneControl: phone, confirm: async () => true }));
    const ok = !t.error && t.value?.ok === true;
    out.push(
      result(`galaxy.${name}`, `Galaxy AI: ${name}`, {
        ms: t.ms,
        ok,
        detail: t.value?.result ? `${t.value.result.length} chars` : undefined,
      }, { weakness_score: ok ? 0 : 40, evidence: ok ? `${t.ms}ms` : (t.error ?? "failed") })
    );
  }
  return out;
}

/** Benchmark the verification layer. */
async function benchVerification() {
  const sample = "On-device AI keeps data private by never sending it to a server.";
  const t = await timeAsync(() =>
    verifyOutput({ task: "Explain on-device privacy", output: sample })
  );
  return result("local.verification", "Verification (Nano/heuristic)", {
    ms: t.ms,
    provider: t.value?.provider ?? "none",
    ok: !t.error,
  }, { weakness_score: 0, evidence: t.value?.provider ?? "none" });
}

/**
 * Run the full on-device benchmark + skill-test suite.
 * @param {object} opts
 * @param {string} [opts.modelFile] - which installed .task model to load
 * @param {string} [opts.backend] - gpu|auto|cpu
 * @param {(line:string)=>void} [opts.onProgress]
 * @returns {Promise<{runId:string,startedAt:string,results:Array}>}
 */
export async function runBenchmarks({ modelFile, backend = "gpu", onProgress } = {}) {
  const report = (m) => typeof onProgress === "function" && onProgress(m);

  report("Detecting runtimes…");
  const mp = await loadMediaPipe();
  const phone = await loadPhoneControl();
  const acc = phone ? await phone.getStatus().catch(() => ({ enabled: false })) : { enabled: false };

  report(`Accessibility: ${acc?.enabled ? "enabled" : "NOT enabled"}`);
  if (!modelFile && mp?.listModels) {
    const { models = [] } = await mp.listModels().catch(() => ({}));
    const ready = models.find((m) => m.loaded) || models[0];
    modelFile = ready?.fileName;
  }
  report(`Model: ${modelFile ?? "none"}`);

  const results = [];

  report("Model benchmarks…");
  results.push(...(await benchModel(mp, modelFile, backend)));
  if (mp?.unloadModel) await mp.unloadModel().catch(() => {});

  report("Phone tools…");
  results.push(...(await benchPhoneTools(phone)));

  report("Galaxy AI skills…");
  results.push(...(await benchGalaxySkills(phone)));

  report("Verification…");
  results.push(await benchVerification());

  // System prompt construction cost (pure).
  const promptMs = (() => {
    const s = performance.now();
    buildAgentSystemPrompt();
    return Math.max(0, Math.round(performance.now() - s));
  })();
  results.push(result("local.system_prompt", "System prompt build", { ms: promptMs, ok: true }, { weakness_score: 0 }));

  return {
    runId: makeRunId(),
    startedAt: nowIso(),
    results,
  };
}
