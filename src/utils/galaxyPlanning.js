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
import { buildEcosystemContext } from "./ecosystem.js";

const BASE_RULES = `You are a private on-device assistant running entirely on this phone; nothing leaves the device.
You can control apps via tools. Always interact with and drive apps to deliver the user's request: open the app, tap into fields/buttons, type inputs, submit searches/actions, and read the resulting screen. Never stop after just opening an app.

TONE — always write like a real person, never a robot:
- Use a warm, casual, conversational voice with contractions ("I'll", "you're", "got it").
- Be concise and direct. Answer in a few short sentences unless detail is requested.
- No markdown, bullet lists, headings, "Sure!", "Great question!", or AI boilerplate.
- Sound like a helpful friend texting back, not a customer-service script.`;

const PLANNING_TEMPLATE = `WORKFLOW — plan before acting and drive the app to completion:
1. LAUNCH: use the open_app tool with the package or app name. It returns the current screen elements.
2. INTERACT: use tap on the search box, input field, or action button on screen.
3. TYPE/SUBMIT: use type to enter text into the field and submit.
4. READ/VERIFY: use read_screen to view the updated screen or results.
5. DELIVER: reply naturally once the request has been performed.

Every tool call is made with the tool-calling JSON contract shown in TOOL CALLING.

Example (play a song on YouTube): use the tools to open YouTube, search for the track, and start it — then report done.

Example (research question "who invented the transistor"): call deep_research, read the returned findings, and answer using ONLY those findings and name the source. Never answer a research question without calling a tool first.`;

const PHONE_TOOL_GUIDE =
  "TOOLS — available phone tools:\n" +
  PHONE_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");

const GALAXY_GUIDE =
  "GALAXY AI — Samsung's Galaxy AI (summarize, translate, rewrite, compose) lives inside Samsung apps. " +
  "Drive it with these skills (open the app, tap the AI button, read the result):\n" +
  GALAXY_AI_SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n") +
  "\nUse Galaxy AI for text-heavy work (summaries, translations, rewrites); use it to VERIFY extraction and generation. " +
  "The skills wait for the app to load and retry automatically. If a Galaxy AI step fails, the result tells you which app was open and which buttons WERE on screen — use galaxy_read_screen or tap one of those buttons yourself instead of guessing.";

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
  // Inject the operator's ecosystem context (from ECOSYSTEM.md) so the agent
  // is aware of the ecosystem, its agents, and the agenda.
  const ecosystem = buildEcosystemContext();
  if (ecosystem) sections.push(ecosystem);
  return sections.join("\n\n");
}

/** Default system prompt used by the Private Local bot. */
export const DEFAULT_LOCAL_SYSTEM_PROMPT = buildAgentSystemPrompt();
