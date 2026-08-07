import { describe, expect, it } from "vitest";
import { PHONE_SKILLS, skillList, runSkill } from "./skillRegistry.js";

describe("skillRegistry", () => {
  it("lists all skills with name + description", () => {
    const list = skillList();
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const s of list) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
    }
  });

  it("current_time returns a valid date string", async () => {
    const r = await runSkill("current_time", {});
    expect(r.ok).toBe(true);
    expect(new Date(r.result).toString()).not.toBe("Invalid Date");
  });

  it("send_to_chat uses the onSend context handler", async () => {
    const sent = [];
    const r = await runSkill("send_to_chat", { text: "hello" }, { onSend: (t) => sent.push(t) });
    expect(r.ok).toBe(true);
    expect(sent).toEqual(["hello"]);
  });

  it("unknown skill returns a clear failure", async () => {
    const r = await runSkill("no_such_skill", {});
    expect(r.ok).toBe(false);
    expect(r.result).toContain("unknown skill");
  });

  it("open_app fails soft without a native platform", async () => {
    const r = await runSkill("open_app", { app: "com.whatsapp" });
    // In the test environment @capacitor/core is not installed → fails soft.
    expect(r.ok).toBe(false);
    expect(r.result).toMatch(/native|no app|Error|Cannot find module|Failed to fetch|import/i);
  });

  it("every skill has a run function", () => {
    for (const s of PHONE_SKILLS) expect(typeof s.run).toBe("function");
  });
});
