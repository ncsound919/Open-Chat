/**
 * galaxyPlanning — system-prompt construction for the on-device agent.
 *
 * Combines:
 *  - private on-device rules
 *  - a multi-step planning template
 *  - the phone-control tool guide
 *  - the Galaxy AI skill guide (drive Samsung AI apps via accessibility)
 */

import { PHONE_TOOLS } from "./phoneTools.js";
import { GALAXY_AI_SKILLS } from "./galaxyAi.js";

const BASE_RULES = `You are a private on-device assistant running entirely on this phone. No data leaves the device.

You can control apps on this phone to help the user accomplish tasks. Before acting, read the screen to understand the current UI. Use tools for anything that changes the screen or other apps. Keep answers concise and confirm key actions before doing destructive ones.`;

const PLANNING_TEMPLATE = `WORKFLOW — plan before you act:
1. STATE: Read the screen / gather what you need (use galaxy_read_screen or read_screen).
2. PLAN: Break the task into small steps. Pick one tool per step.
3. DO: Execute one step at a time. After each tool call you receive the result.
4. VERIFY: Read the screen again to confirm the step had the intended effect. If it didn't, adjust.
5. REPORT: Only reply in plain text when the goal is reached. Never claim success you didn't verify.

Example chain for "summarize my last note":
  galaxy_open {app: notes} -> galaxy_ai_action {app: notes, action: summarize} -> galaxy_read_screen {} -> final answer`;

const PHONE_TOOL_GUIDE =
  "TOOLS — available phone tools:\n" +
  PHONE_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");

const GALAXY_GUIDE =
  "GALAXY AI — Samsung's Galaxy AI (summarize, translate, rewrite, compose) lives inside Samsung apps. " +
  "Drive it with these skills (they open the app, tap the AI button, and read the result):\n" +
  GALAXY_AI_SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n") +
  "\nUse Galaxy AI for text-heavy work (summaries, translations, rewrites); use it to VERIFY extraction and generation. If a Galaxy AI step fails, say what you found on screen instead of guessing.";

/**
 * Build the full system prompt for the local agent.
 * @param {object} [opts]
 * @param {boolean} [opts.planning] - include the planning template (default true)
 * @param {boolean} [opts.galaxy] - include the Galaxy AI skill guide (default true)
 * @param {boolean} [opts.phoneTools] - include the phone-control tool guide (default true)
 * @param {string} [opts.extra] - additional custom instructions
 * @returns {string}
 */
export function buildAgentSystemPrompt({ planning = true, galaxy = true, phoneTools = true, extra } = {}) {
  const sections = [BASE_RULES];
  if (planning) sections.push(PLANNING_TEMPLATE);
  if (phoneTools) sections.push(PHONE_TOOL_GUIDE);
  if (galaxy) sections.push(GALAXY_GUIDE);
  if (extra) sections.push(extra);
  return sections.join("\n\n");
}

/** Default system prompt used by the Private Local bot. */
export const DEFAULT_LOCAL_SYSTEM_PROMPT = buildAgentSystemPrompt();
