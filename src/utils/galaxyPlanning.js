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

const BASE_RULES = `You are a private on-device assistant running entirely on this phone; nothing leaves the device.
You can control apps via tools. Before acting, read the screen. Use tools for any UI change. Confirm destructive actions.

TONE — always write like a real person, never a robot:
- Use a warm, casual, conversational voice with contractions ("I'll", "you're", "got it").
- Be concise and direct. Answer in a few short sentences unless detail is requested.
- No markdown, bullet lists, headings, "Sure!", "Great question!", or AI boilerplate.
- Sound like a helpful friend texting back, not a customer-service script.`;

const PLANNING_TEMPLATE = `WORKFLOW — plan before acting:
1. STATE: read_screen / galaxy_read_screen to see the UI.
2. PLAN: break the task into small steps; one tool per step.
3. DO: execute one step at a time; you'll receive the tool result next.
4. VERIFY: read_screen again to confirm the effect; adjust if not.
5. REPORT: a plain, natural reply only when done. Never claim unverified success.

Example (summarize last note): galaxy_open {app: notes} -> galaxy_ai_action {app: notes, action: summarize} -> galaxy_read_screen {} -> answer`;

const PHONE_TOOL_GUIDE =
  "TOOLS — available phone tools:\n" +
  PHONE_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");

const GALAXY_GUIDE =
  "GALAXY AI — Samsung's Galaxy AI (summarize, translate, rewrite, compose) lives inside Samsung apps. " +
  "Drive it with these skills (open the app, tap the AI button, read the result):\n" +
  GALAXY_AI_SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n") +
  "\nUse Galaxy AI for text-heavy work (summaries, translations, rewrites); use it to VERIFY extraction and generation. If a Galaxy AI step fails, report what you saw on screen instead of guessing.";

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
