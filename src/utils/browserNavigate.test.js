import { describe, it, expect, vi } from "vitest";
import {
  findOmnibox,
  arrivedAt,
  navigateTo,
} from "./browserNavigate.js";

const TIMING = { settleMs: 10, navTimeoutMs: 60 };

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

// A mid-page textarea on a restored tab (e.g. an AI Studio prompt box).
const PAGE_TEXTAREA = {
  text: "Type your prompt…",
  editable: true,
  clickable: true,
  viewId: "",
  x: 0,
  y: 600,
  w: 700,
  h: 120,
};

/** Phone whose screen becomes the target page once the URL is typed. */
function navigatingPhone(targetUrl) {
  let submittedOnce = false;
  return {
    getStatus: vi.fn(async () => ({ enabled: true })),
    openApp: vi.fn(async () => ({ ok: true })),
    readScreen: vi.fn(async () => {
      if (!submittedOnce) return { nodes: [{ ...OMNIBOX, text: "" }, PAGE_TEXTAREA] };
      return {
        foregroundPackage: "com.android.chrome",
        nodes: [
          { ...OMNIBOX, text: targetUrl },
          { text: "Quantum computing - Wikipedia", editable: false, x: 0, y: 130, w: 700, h: 40 },
          { text: "Quantum computing studies quantum computers.", editable: false, x: 0, y: 300, w: 700, h: 40 },
        ],
      };
    }),
    performTap: vi.fn(async () => ({ ok: true })),
    inputText: vi.fn(async ({ text }) => {
      if (text === targetUrl) submittedOnce = true;
      return { ok: true };
    }),
    submitText: vi.fn(async () => ({ ok: true })),
  };
}

describe("findOmnibox", () => {
  it("prefers the omnibox viewId", () => {
    const nodes = [{ editable: true, viewId: "", y: 10 }, { editable: true, viewId: "com.android.chrome:id/url_bar", y: 40 }];
    expect(findOmnibox(nodes).viewId).toMatch(/url_bar/);
  });

  it("falls back to the topmost editable node in the top band only", () => {
    const nodes = [PAGE_TEXTAREA, { ...PAGE_TEXTAREA, y: 100 }];
    expect(findOmnibox(nodes)?.y).toBe(100);
  });

  it("returns null when only mid-page fields exist and no top-band node", () => {
    expect(findOmnibox([PAGE_TEXTAREA])).toBeNull();
  });
});

describe("arrivedAt", () => {
  it("matches host+path regardless of scheme, www, query, or trailing slash", () => {
    expect(arrivedAt("google.com/search?q=x", "https://www.google.com/search?q=y")).toBe(true);
    expect(arrivedAt("https://en.wikipedia.org/wiki/Cat/", "en.wikipedia.org/wiki/Cat")).toBe(true);
    expect(arrivedAt("https://evil.test/search", "https://www.google.com/search")).toBe(false);
    expect(arrivedAt("", "https://google.com")).toBe(false);
  });
});

describe("navigateTo", () => {
  it("requires a valid URL", async () => {
    expect((await navigateTo({ url: "not a url" })).ok).toBe(false);
    expect((await navigateTo({})).ok).toBe(false);
  });

  it("navigates via the omnibox from ANY starting page and verifies arrival", async () => {
    const target = "https://en.wikipedia.org/wiki/Quantum_computing";
    const phone = navigatingPhone(target);
    const res = await navigateTo({ url: target, phoneControl: phone, timing: TIMING });

    expect(phone.openApp).toHaveBeenCalledWith({ packageName: "com.android.chrome" });
    // Typed the exact URL; tapped only near the omnibox.
    expect(phone.inputText.mock.calls[0][0].text).toBe(target);
    const tappedYs = phone.performTap.mock.calls.map((c) => c[0].y);
    for (const y of tappedYs) expect(y).toBeLessThan(320);

    expect(res.ok).toBe(true);
    expect(res.url).toContain("wikipedia.org/wiki/Quantum_computing");
    expect(res.title).toContain("Quantum computing");
    expect(res.text).toContain("quantum computers");
    expect(res.note).toMatch(/verified/i);
  });

  it("never types when no omnibox is present", async () => {
    const phone = navigatingPhone("https://example.com/x");
    phone.readScreen.mockImplementation(async () => ({ nodes: [PAGE_TEXTAREA] }));
    const res = await navigateTo({ url: "https://example.com/x", phoneControl: phone, timing: TIMING });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/address bar/i);
    expect(phone.inputText).not.toHaveBeenCalled();
    expect(res.error).toMatch(/tell the user navigation failed/i);
  });

  it("fails honestly when the page never arrives", async () => {
    const phone = navigatingPhone("https://example.com/x");
    // Screen stays on a different site forever.
    phone.readScreen.mockImplementation(async () => ({
      nodes: [
        { ...OMNIBOX, text: "example.com/other" },
        { text: "some other page", editable: false, x: 0, y: 300, w: 100, h: 30 },
      ],
    }));
    const res = await navigateTo({
      url: "https://en.wikipedia.org/wiki/Quantum_computing",
      phoneControl: phone,
      timing: TIMING,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/did not reach/i);
  });

  it("reports disabled accessibility", async () => {
    const phone = { getStatus: vi.fn(async () => ({ enabled: false })) };
    const res = await navigateTo({ url: "https://example.com", phoneControl: phone });
    expect(res.needs_enablement).toBe(true);
  });
});
