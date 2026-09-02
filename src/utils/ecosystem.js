/**
 * ecosystem — loads the bundled ECOSYSTEM.md and turns it into a compact
 * system-prompt supplement so the on-device agent is aware of the operator's
 * ecosystem, agents, and agenda.
 *
 * Users edit ECOSYSTEM.md (repo root / bundled asset) to describe their own
 * world; Open Chat injects it into the local model's context automatically.
 */

import ecosystemMd from "../../ECOSYSTEM.md?raw";

/** Extract the useful body of ECOSYSTEM.md (strip the template header + how-to
 *  and the trailing criteria checklist so only the operator's content feeds
 *  the model). Returns "" if nothing usable / only placeholders are present. */
export function buildEcosystemContext() {
  try {
    const text = String(ecosystemMd || "");

    // Keep only the section between the "# YOUR ECOSYSTEM" heading and the
    // "# Criteria" heading (the operator's actual content).
    let body = text;
    const startIdx = text.indexOf("# YOUR ECOSYSTEM");
    if (startIdx >= 0) body = text.slice(startIdx);
    const endIdx = body.indexOf("# Criteria");
    if (endIdx >= 0) body = body.slice(0, endIdx);

    body = body.replace(/^---.*$/gm, "").trim();

    // Drop placeholder / template-only content so a blank ECOSYSTEM.md does
    // not inject instructions like "Describe your ecosystem here." into the
    // model context.
    const placeholderMarkers = [
      "Describe your ecosystem here",
      "(Agent 1",
      "(Agent 2",
      "(Current focus",
      "(This week",
      "(Ongoing priority",
      "YOUR ECOSYSTEM",
    ];
    const hasRealContent = (() => {
      const lines = body.split("\n").filter((l) => l.trim().length > 0);
      const meaningful = lines.filter((l) => {
        const t = l.trim();
        // Skip section headings and placeholder markers.
        if (/^#{1,3}\s/.test(t)) return false;
        if (placeholderMarkers.some((m) => t.includes(m))) return false;
        return true;
      });
      return meaningful.length >= 2;
    })();
    if (!hasRealContent) return "";

    return (
      "ECOSYSTEM CONTEXT — the operator's ecosystem, agents, and agenda. " +
      "Treat this as accurate and current; use it to ground your answers:\n\n" +
      body
    );
  } catch {
    return "";
  }
}
