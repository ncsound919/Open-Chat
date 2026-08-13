/**
 * skillTests — a test suite for the on-device skill pack (Galaxy AI + phone
 * control). Each case runs live against the accessibility bridge and reports
 * pass/fail plus latency. Used by the benchmark runner and the Models screen.
 */

import { execPhoneTool } from "./phoneTools.js";
import { execGalaxySkill } from "./galaxyAi.js";
import { timeAsync } from "./benchmarks.js";

/** Skill test cases. `kind`: "phone" | "galaxy". */
export const SKILL_TEST_CASES = [
  { name: "get_foreground", kind: "phone", skill: "get_foreground", args: {}, desc: "Current foreground app" },
  { name: "read_screen", kind: "phone", skill: "read_screen", args: {}, desc: "Read the visible UI tree" },
  { name: "open_notes", kind: "galaxy", skill: "galaxy_open", args: { app: "notes" }, desc: "Open Samsung Notes" },
  { name: "open_messages", kind: "galaxy", skill: "galaxy_open", args: { app: "messages" }, desc: "Open Samsung Messages" },
  { name: "galaxy_read_screen", kind: "galaxy", skill: "galaxy_read_screen", args: {}, desc: "Read screen after Galaxy action" },
  { name: "galaxy_ai_summarize", kind: "galaxy", skill: "galaxy_ai_action", args: { app: "notes", action: "summarize" }, desc: "Trigger AI summarize in Notes" },
  { name: "galaxy_ai_translate", kind: "galaxy", skill: "galaxy_ai_action", args: { app: "messages", action: "translate" }, desc: "Trigger AI translate in Messages" },
  { name: "press_back", kind: "phone", skill: "press", args: { key: "back" }, desc: "Navigate back" },
];

/**
 * Run all skill tests live against the phone.
 * @param {object} opts
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @param {(line:string)=>void} [opts.onProgress]
 * @param {(req:object)=>Promise<boolean>} [opts.confirm] - confirmation gate;
 *   defaults to auto-approve because this is an explicit user-triggered
 *   self-test of the accessibility bridge, not an autonomous agent path.
 * @returns {Promise<Array<{name,desc,kind,ok,ms,detail}>>}
 */
export async function runSkillTests({ phoneControl, onProgress, confirm = async () => true } = {}) {
  const report = (m) => typeof onProgress === "function" && onProgress(m);
  const phone = phoneControl ?? null;
  const results = [];

  for (const test of SKILL_TEST_CASES) {
    report(`→ ${test.name}`);
    if (!phone) {
      results.push({ name: test.name, desc: test.desc, kind: test.kind, ok: false, ms: 0, detail: "no phone-control bridge" });
      continue;
    }
    const runner = test.kind === "galaxy"
      ? () => execGalaxySkill(test.skill, test.args, { phoneControl: phone, confirm })
      : () => execPhoneTool(test.skill, test.args, { phoneControl: phone, confirm });
    const t = await timeAsync(runner);
    const val = t.value;
    const ok = !t.error && val?.ok === true && !val?.needs_enablement;
    results.push({
      name: test.name,
      desc: test.desc,
      kind: test.kind,
      ok,
      ms: t.ms,
      detail: t.error ?? (val?.needs_enablement ? "accessibility not enabled" : val?.result ? `${String(val.result).length} chars` : val?.app ?? "ok"),
    });
  }

  return results;
}
