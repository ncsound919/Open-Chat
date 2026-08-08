/**
 * verification — optional quality layer for on-device agent output.
 *
 * Primary: Gemini Nano (Chrome built-in Prompt API) cross-checks an output
 * against the task for accuracy/hallucination. Fallback: deterministic
 * heuristics so verification still returns a useful verdict off-line.
 */

import { isAvailable, generate } from "./OnDeviceAI.js";

const VERIFY_PROMPT = (task, output) => `You are a strict fact-checker. The user asked a task and an AI produced an output.
Task: ${task.slice(0, 1500)}
Output: ${output.slice(0, 3000)}

Check the output for correctness, completeness, and hallucination relative to the task.
Respond with ONLY a JSON object:
{"ok":true|false,"score":0-100,"issues":["brief issue or none"]}`;

/**
 * Deterministic heuristic check used when no verification model is present.
 */
export function heuristicCheck(task, output) {
  const o = String(output ?? "").trim();
  const issues = [];
  if (!o) issues.push("empty output");
  if (o.length < 4) issues.push("output too short");
  if (/(error|failed|unavailable|timed out)/i.test(o)) issues.push("output contains an error marker");
  if (o.includes("undefined") || o.includes("[object Object]")) issues.push("output contains unrendered data");
  const score = issues.length ? Math.max(10, 100 - issues.length * 25) : 90;
  return { ok: issues.length === 0, score, issues: issues.length ? issues : ["none"], provider: "heuristic" };
}

/**
 * Verify an agent output against its task.
 * @param {object} opts
 * @param {string} opts.task - original user request
 * @param {string} opts.output - agent's final answer
 * @param {boolean} [opts.enabled] - master switch (default true)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:boolean,score:number,issues:string[],provider:string,reason?:string}>}
 */
export async function verifyOutput({ task, output, enabled = true, signal } = {}) {
  if (!enabled) return { ok: true, score: 100, issues: ["verification disabled"], provider: "off" };
  if (!task || !output) return { ok: false, score: 0, issues: ["missing input"], provider: "none" };

  try {
    if (await isAvailable()) {
      const raw = await generate(VERIFY_PROMPT(task, output), { signal, temperature: 0 });
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (parsed && typeof parsed.ok === "boolean") {
        return {
          ok: parsed.ok,
          score: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          provider: "nano",
        };
      }
      return heuristicCheck(task, output);
    }
  } catch {
    /* fall through to heuristic */
  }
  return heuristicCheck(task, output);
}
