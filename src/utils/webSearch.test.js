import { describe, it, expect, vi } from "vitest";
import { webSearch, WEB_SEARCH_TOOL } from "./webSearch.js";

const CHROME_OMNIBOX = { text: "", editable: true, clickable: false, x: 0, y: 200, w: 720, h: 50 };
const SUGGESTION = { text: "gemma 3n model", clickable: true, editable: false, x: 0, y: 300, w: 720, h: 50 };

function fakePhone({ nodes, submit = true }) {
  return {
    getStatus: vi.fn(async () => ({ enabled: true })),
    openApp: vi.fn(async () => ({ ok: true })),
    readScreen: vi.fn(async () => ({ nodes })),
    performTap: vi.fn(async () => ({ ok: true })),
    inputText: vi.fn(async () => ({ ok: true })),
    submitText: vi.fn(async () => ({ ok: submit })),
  };
}

describe("WEB_SEARCH_TOOL", () => {
  it("has the expected schema", () => {
    expect(WEB_SEARCH_TOOL.name).toBe("web_search");
    expect(WEB_SEARCH_TOOL.parameters.query).toBeDefined();
  });
});

describe("webSearch", () => {
  it("requires a query", async () => {
    const res = await webSearch({});
    expect(res.ok).toBe(false);
  });

  it("reports when the accessibility service is disabled", async () => {
    const phone = {
      getStatus: vi.fn(async () => ({ enabled: false })),
    };
    const res = await webSearch({ query: "x", phoneControl: phone });
    expect(res.ok).toBe(false);
    expect(res.needs_enablement).toBe(true);
  });

  it("declines when the user does not confirm", async () => {
    const phone = fakePhone({ nodes: [] });
    const res = await webSearch({ query: "x", phoneControl: phone, confirm: async () => false });
    expect(res.ok).toBe(false);
    expect(res.declined).toBe(true);
  });

  it("opens Chrome, types the query, submits via IME enter, and returns results", async () => {
    const phone = fakePhone({ nodes: [CHROME_OMNIBOX, SUGGESTION, { text: "Gemma 3n is a small model", clickable: false, editable: false, x: 0, y: 400, w: 720, h: 40 }] });
    const confirm = vi.fn(async () => true);
    const res = await webSearch({ query: "gemma 3n model", phoneControl: phone, confirm });

    expect(confirm).toHaveBeenCalled();
    expect(phone.openApp).toHaveBeenCalledWith({ packageName: "com.android.chrome" });
    expect(phone.performTap).toHaveBeenCalled(); // focus the omnibox
    expect(phone.inputText).toHaveBeenCalledWith({ text: "gemma 3n model" });
    expect(phone.submitText).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("chrome");
    expect(res.results.some((t) => /Gemma 3n/.test(t))).toBe(true);
    // Returns to Open-Chat so the answer is visible without switching back.
    expect(phone.openApp).toHaveBeenCalledWith({ packageName: "com.openchat.app" });
  });

  it("falls back to tapping a suggestion when IME submit is unavailable", async () => {
    const phone = fakePhone({ nodes: [CHROME_OMNIBOX, SUGGESTION, { text: "result", clickable: false, editable: false, x: 0, y: 400, w: 720, h: 40 }], submit: false });
    const res = await webSearch({ query: "gemma 3n model", phoneControl: phone, confirm: async () => true });
    expect(phone.submitText).toHaveBeenCalled();
    expect(phone.performTap).toHaveBeenCalled(); // fallback suggestion tap
    expect(res.ok).toBe(true);
  });
});
