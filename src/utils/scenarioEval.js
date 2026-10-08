/**
 * scenarioEval — a deterministic battery of real Open-Chat scenarios used to
 * compare on-device models (Qwen3.5-4B / Qwen3.5-0.8B / Gemma 4 E2B).
 *
 * Each scenario runs through the REAL chat + tool path (LocalModelClient.send →
 * chatLocal → native LiteRT-LM). The scorer is pure so it is unit-testable and
 * the same across models — a difference in scores is a difference in models.
 */

import { looksDegenerate } from "./localChat.js";

export const SCENARIOS = [
  { id: "plain", label: "Plain chat", prompt: "Say hello in one short friendly sentence." },
  { id: "math", label: "Math", prompt: "What is 127 * 48? Answer with the number only." },
  { id: "code", label: "Code", prompt: "Write a JavaScript function that returns the max of two numbers. Just the code." },
  { id: "tool_web", label: "Tool: web_search", prompt: "Search the web for the capital of France.", expectTool: true, tools: ["web_search"] },
  { id: "tool_research", label: "Tool: deep_research", prompt: "Research what causes the northern lights.", expectTool: true, tools: ["deep_research"] },
  { id: "news", label: "News intent", prompt: "bbc coverage of ukraine today", expectResearch: true },
  { id: "tool_app", label: "Tool: open_app", prompt: "open whatsapp", expectTool: true, tools: ["open_app"] },
  { id: "json", label: "Strict JSON", prompt: 'Reply with ONLY this exact JSON object, nothing else: {"ok": true, "value": 42}', expectJson: true },
  { id: "constrained", label: "Constrained (3 words)", prompt: "Answer in exactly three words: what is the color of the sky on a clear day?" },
  { id: "summary", label: "Summarize", prompt: "Summarize in one sentence: The northern lights are caused by charged particles from the sun colliding with gases in Earth's atmosphere, exciting them and emitting colorful light near the poles." },
];

export function classForScenario(s) {
  if (s.expectJson) return "json";
  if (s.expectTool) return "tool";
  if (s.expectResearch) return "research";
  if (s.id === "plain") return "chat";
  if (s.id === "math") return "math";
  if (s.id === "code") return "code";
  if (s.id === "constrained") return "constrained";
  return "chat";
}

/** Keyword hints used for loose correctness scoring. */
const HINTS = {
  math: ["6096"],
  code: ["max", "function"],
  constrained: ["blue", "clear"],
  plain: ["hello", "hi", "hey"],
};

/**
 * Score one scenario's outcome. Pure — same input always yields the same score.
 * @returns {{ok:boolean, issues:string[], score:number, checks:string[]}}
 */
export function scoreScenario(scenario, outcome) {
  const issues = [];
  const checks = [];
  const reply = String(outcome.reply || "").trim();
  const toolCalls = Array.isArray(outcome.toolCalls) ? outcome.toolCalls : [];

  checks.push("reply:nonempty");
  if (!reply) {
    issues.push("empty reply");
  } else {
    if (looksDegenerate(reply)) {
      issues.push("degenerate/garbled output");
      checks.push("degenerate:clean");
    } else {
      checks.push("degenerate:clean");
    }
  }

  const toolFired = toolCalls.length > 0;
  const toolName = toolFired ? String(toolCalls[0]?.name || "") : "";

  if (scenario.expectTool) {
    checks.push("tool:fired");
    if (!toolFired) {
      issues.push("expected a tool call but the model answered directly");
    } else {
      const expected = scenario.tools || [];
      if (expected.length && !expected.includes(toolName)) {
        issues.push(`called wrong tool "${toolName}" (expected ${expected.join("|")})`);
        checks.push("tool:right-name");
      } else {
        checks.push("tool:right-name");
      }
    }
  }

  if (scenario.expectJson) {
    checks.push("json:parseable");
    try {
      const parsed = JSON.parse(reply);
      if (!parsed || parsed.ok !== true || parsed.value !== 42) {
        issues.push("JSON parsed but did not match the requested object");
        checks.push("json:shape");
      } else {
        checks.push("json:shape");
      }
    } catch {
      issues.push("reply is not parseable JSON");
    }
  }

  if (scenario.expectResearch) {
    checks.push("research:grounded");
    const grounded = /sources|source|based on|according to|verified/i.test(reply);
    if (!grounded) issues.push("research reply did not reference sources");
    else checks.push("research:sources-mentioned");
  }

  // Loose keyword correctness for the deterministic scenarios.
  const hints = HINTS[scenario.id];
  if (hints) {
    checks.push("hint:match");
    const lower = reply.toLowerCase();
    if (!hints.some((h) => lower.includes(h.toLowerCase()))) {
      issues.push(`expected a keyword (${hints.join("|")}) in the reply`);
    } else {
      checks.push("hint:matched");
    }
  }

  const score = Math.max(0, checks.filter((c) => !c.startsWith("!")).length - issues.length);
  return { ok: issues.length === 0, issues, score, checks };
}

/** Run the full battery against a send function and return per-scenario results. */
export async function runScenarioBattery({ send, onScenario }) {
  const results = [];
  for (const scenario of SCENARIOS) {
    const started = Date.now();
    let toolCalls = [];
    let reply = "";
    try {
      const out = await send(scenario.prompt, (delta) => (reply += delta));
      if (out && typeof out === "object") {
        if (Array.isArray(out.toolCalls)) toolCalls = out.toolCalls;
        if (typeof out.reply === "string") reply = out.reply;
        else if (typeof out.text === "string") reply = out.text;
      } else if (typeof out === "string") {
        reply = out;
      }
    } catch (e) {
      reply = "";
    }
    const latencyMs = Date.now() - started;
    const scored = scoreScenario(scenario, { reply, toolCalls });
    const row = { id: scenario.id, label: scenario.label, prompt: scenario.prompt, reply: reply.slice(0, 400), toolCalls, latencyMs, ...scored };
    results.push(row);
    onScenario?.(row);
  }
  const ok = results.filter((r) => r.ok).length;
  const avgLatency = results.length ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length) : 0;
  return { total: results.length, ok, latencyMs: avgLatency, results };
}