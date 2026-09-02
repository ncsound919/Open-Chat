import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch, WEB_SEARCH_TOOL } from "./webSearch.js";

const TIMING = { settleMs: 10, navTimeoutMs: 60 };

// Omnibox near the top of the screen (address-bar region).
const OMNIBOX = {
  text: "",
  editable: true,
  clickable: false,
  viewId: "com.android.chrome:id/url_bar",
  x: 0,
  y: 40,
  w: 720,
  h: 50,
};

// A mid-page textarea (e.g. an AI Studio prompt box on a restored tab).
const PAGE_TEXTAREA = {
  text: "Type your prompt…",
  desc: "",
  editable: true,
  clickable: true,
  viewId: "",
  x: 0,
  y: 600,
  w: 700,
  h: 120,
};

function resultsPageScreen() {
  return {
    foregroundPackage: "com.android.chrome",
    nodes: [
      { ...OMNIBOX, text: "google.com/search?q=gemma+3n+model" },
      { text: "Gemma 3n — a small on-device model", clickable: true, editable: false, x: 0, y: 300, w: 720, h: 40 },
      { text: "Gemma 3n is designed for efficient on-device inference.", clickable: false, editable: false, x: 0, y: 350, w: 720, h: 40 },
      { text: "All", clickable: false, editable: false, x: 0, y: 200, w: 40, h: 30 },
    ],
  };
}

/** Phone whose screen changes after the search is submitted. */
function navigatingPhone({ submit = true } = {}) {
  let submittedOnce = false;
  return {
    getStatus: vi.fn(async () => ({ enabled: true })),
    openApp: vi.fn(async () => ({ ok: true })),
    readScreen: vi.fn(async () => {
      if (!submittedOnce) {
        // Restored tab with a mid-page textarea + omnibox at top.
        return { nodes: [{ ...OMNIBOX, text: "" }, PAGE_TEXTAREA] };
      }
      return resultsPageScreen();
    }),
    performTap: vi.fn(async () => ({ ok: true })),
    inputText: vi.fn(async ({ text }) => {
      if (/google\.[a-z.]+\/search/.test(text)) submittedOnce = true;
      return { ok: true };
    }),
    submitText: vi.fn(async () => ({ ok: submit })),
  };
}

function mockFactualFetch() {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      title: "Gemma",
      description: "model family",
      extract: "Gemma is a family of lightweight models.",
    }),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    const phone = { getStatus: vi.fn(async () => ({ enabled: false })) };
    const res = await webSearch({ query: "x", phoneControl: phone });
    expect(res.ok).toBe(false);
    expect(res.needs_enablement).toBe(true);
  });

  it("declines when the user does not confirm", async () => {
    const phone = navigatingPhone();
    const res = await webSearch({ query: "x", phoneControl: phone, confirm: async () => false, timing: TIMING });
    expect(res.ok).toBe(false);
    expect(res.declined).toBe(true);
    expect(phone.inputText).not.toHaveBeenCalled();
  });

  it("navigates by URL through the omnibox and returns VERIFIED results", async () => {
    const phone = navigatingPhone();
    const confirm = vi.fn(async () => true);
    const res = await webSearch({ query: "gemma 3n model", phoneControl: phone, confirm, timing: TIMING });

    expect(confirm).toHaveBeenCalled();
    expect(phone.openApp).toHaveBeenCalledWith({ packageName: "com.android.chrome" });

    // Typed a full Google search URL into the omnibox.
    const typedArg = phone.inputText.mock.calls[0][0];
    expect(typedArg.text).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);

    // Never touched the mid-page textarea: only one tap (the omnibox).
    const tapped = phone.performTap.mock.calls.map((c) => c[0]);
    const omniboxCenterY = Math.round(OMNIBOX.y + OMNIBOX.h / 2);
    expect(tapped.length).toBe(1);
    expect(tapped[0].y).toBe(omniboxCenterY);

    expect(res.ok).toBe(true);
    expect(res.provider).toBe("chrome");
    expect(res.pageUrl).toMatch(/google\.[a-z.]+\/search/);
    expect(res.results.some((t) => /Gemma 3n/.test(t))).toBe(true);
    expect(res.note).toMatch(/ONLY/i);
    // Returns to Open-Chat so the answer is visible without switching back.
    expect(phone.openApp).toHaveBeenCalledWith({ packageName: "com.openchat.app" });
  });

  it("refuses to type when no omnibox exists — falls back to factual APIs", async () => {
    const phone = navigatingPhone();
    // No omnibox anywhere: only the AI Studio style textarea.
    phone.readScreen.mockImplementation(async () => ({ nodes: [PAGE_TEXTAREA] }));
    mockFactualFetch();

    const res = await webSearch({ query: "gemma model", phoneControl: phone, timing: TIMING });

    expect(phone.inputText).not.toHaveBeenCalled(); // never typed into page content
    expect(phone.performTap).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("factual-search");
    expect(res.chromeError).toMatch(/address bar/i);
    expect(res.note).toMatch(/do NOT claim you browsed/i);
  });

  it("labels factual fallback honestly when navigation fails", async () => {
    const phone = navigatingPhone({ submit: true });
    // After submit, screen NEVER becomes a results page.
    phone.readScreen.mockImplementation(async () => ({
      nodes: [{ ...OMNIBOX, text: "example.com/page" }, PAGE_TEXTAREA],
    }));
    mockFactualFetch();

    const res = await webSearch({ query: "gemma model", phoneControl: phone, timing: TIMING });

    expect(phone.inputText).toHaveBeenCalled(); // did try via omnibox
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("factual-search");
    expect(res.chromeError).toMatch(/did not reach|could not/i);
    expect(res.results.length).toBeGreaterThan(0);
  });

  it("fails closed with guidance when nothing verifies", async () => {
    const phone = navigatingPhone();
    phone.readScreen.mockImplementation(async () => ({
      nodes: [{ ...OMNIBOX, text: "example.com/page" }],
    }));
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    });

    const res = await webSearch({ query: "gemma model", phoneControl: phone, timing: TIMING });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/tell the user you could not complete the research/i);
  });

  it("uses factual APIs directly when phone control is unavailable", async () => {
    mockFactualFetch();
    const res = await webSearch({ query: "gemma model", phoneControl: {} });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("factual-search");
  });
});
