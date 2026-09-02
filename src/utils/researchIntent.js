/**
 * researchIntent — deterministic research interception for small models.
 *
 * Gemma-class models routinely ignore tool-calling guidance and answer
 * factual questions from memory ("made up its own summary"). Instead of
 * hoping the model calls web_search/deep_research, detect research-style
 * requests up front, run the research deterministically BEFORE generation,
 * and inject the verified findings into the model's context as the ONLY
 * permitted answer material.
 */

/**
 * Detect whether a user message asks for research/factual lookup.
 * Deliberately conservative-positive: for a local model, grounded context
 * is cheap and hallucination is expensive.
 *
 * Returns null when the message is not research, otherwise
 * `{ research: true, query, kind: "stable" | "fresh" }` where
 *   - "stable"  → encyclopedia/lookup is fine (Wikipedia summaries are reliable)
 *   - "fresh"   → time-sensitive; only the live web has current data
 *                 (Wikipedia/DDG-instant have no current news, weather, prices,
 *                 or scores — feeding them in causes hallucinated answers)
 *
 * @param {string} text - user message
 * @returns {{ research: true, query: string, kind: "stable" | "fresh" } | null}
 */
export function detectResearchIntent(text) {
  const t = String(text ?? "").trim();
  if (t.length < 6) return null;
  // Single keyword with nothing to actually research.
  if (t.split(/\s+/).length < 2) return null;

  // Device/app commands are NOT research even when phrased as questions
  // ("what time is my meeting") or containing lookup-ish verbs.
  const command =
    /^(hey\s+)?(open|play|tap|type|press|swipe|close|launch|start|send|call|text|set|show|list|clear|delete|remove|turn|run|stop|pause|skip|toggle)\b/i;
  const personal =
    /\bmy\s+(meeting|meetings|calendar|schedule|appointments?|reminders?|messages?|inbox|day)\b/i;
  if (command.test(t) || personal.test(t)) return null;

  // Current-events phrasing needs live data by definition. Wikipedia and
  // DDG-instant-answer have NO current data — if we ask them about
  // "breaking news" they return unrelated stubs that the model stitches
  // into nonsense. Route these straight to live web search.
  const current =
    /\b(latest|newest|today|yesterday|this week|this month|right now|current(ly)?|recent|breaking|news|price of|stock|weather|score|happening|just\s+now|update on|updates on|as of)\b/i;
  if (current.test(t)) return { research: true, query: t, kind: "fresh" };

  // Explicit research verbs win immediately.
  const explicit =
    /\b(research|look\s?up|look\s?it\s?up|search(ing)?( for| the web| online)?|google|fact[\s-]?check)\b/i;
  if (explicit.test(t)) return { research: true, query: t, kind: "fresh" };

  // Factual question patterns about topics/entities → encyclopedia-grade
  // sources are fine for these ("who invented X", "history of Y").
  const factual = /^\s*(who|what|when|where|which|why|how)\b/i;
  const knownEntity =
    /\b(according to|sources?|cite|citation|wikipedia|history of|definition of|meaning of)\b/i;
  if ((factual.test(t) || knownEntity.test(t)) && t.split(/\s+/).length >= 4) {
    return { research: true, query: t, kind: "stable" };
  }

  return null;
}

/**
 * Build the grounding section injected into the system prompt when
 * auto-research succeeded.
 * @param {object} dr - deepResearch() result ({ summary, sourcesUsed })
 */
export function buildGroundingSection(dr) {
  const sources = Array.isArray(dr.sourcesUsed) ? dr.sourcesUsed.join(", ") : "verified APIs";
  return [
    "VERIFIED RESEARCH FINDINGS — sources: " + sources,
    dr.summary,
    "INSTRUCTIONS: Research is ALREADY COMPLETE — do NOT call deep_research, web_search, or navigate again. Answer the user NOW in your own words using ONLY these verified findings. Name which source(s) the information came from. If these findings do not fully answer the question, say exactly what is missing instead of guessing. Do NOT add facts from memory. Do NOT repeat these instructions or the findings verbatim — write a natural, friendly reply.",
  ].join("\n\n");
}

/** Grounding section used when auto-research ran but found nothing verifiable. */
export const RESEARCH_FAILED_SECTION = [
  "AUTO-RESEARCH FAILED: no verified sources could be reached.",
  "You MUST tell the user that the research could not be completed and offer to retry. Do NOT answer the question from memory or invent a summary.",
].join("\n");
