import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RECIPE_TOOLS,
  gmailInbox,
  calendarEvents,
  driveBrowse,
  geminiQuery,
  youtubeSearch,
  runRecipe,
} from "./appRecipes.js";

vi.mock("./modelRegistry.js", () => ({
  loadPhoneControl: vi.fn(async () => ({
    getStatus: async () => ({ enabled: true }),
    openApp: async () => ({ ok: true }),
    submitText: async () => ({ ok: true }),
    readScreen: async () => ({ nodes: [] }),
  })),
}));

vi.mock("./phoneTools.js", () => ({
  execPhoneTool: vi.fn(async (name, args, opts) => {
    if (typeof opts?.confirm === "function") {
      await opts.confirm({ name, args, description: `run ${name}` });
    }
    switch (name) {
      case "open_app":
        return { ok: true };
      case "read_screen":
        return {
          ok: true,
          elements: [
            { text: "Subject: Hello", editable: false, x: 0, y: 0, w: 100, h: 20 },
            { text: "", editable: true, x: 10, y: 200, w: 200, h: 40 },
          ],
        };
      case "tap":
        return { ok: true };
      case "type":
        return { ok: true };
      default:
        return { ok: true };
    }
  }),
}));

import { execPhoneTool } from "./phoneTools.js";

describe("appRecipes tool schemas", () => {
  it("defines the five recipe tools", () => {
    expect(RECIPE_TOOLS.map((t) => t.name)).toEqual([
      "gmail_inbox",
      "calendar_events",
      "drive_browse",
      "gemini_query",
      "youtube_search",
    ]);
  });
});

describe("gmailInbox", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens Gmail, reads the screen, and returns elements", async () => {
    const confirm = vi.fn(async () => true);
    const res = await gmailInbox({ confirm });
    expect(res.ok).toBe(true);
    expect(res.app).toBe("com.google.android.gm");
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.gm" },
      expect.anything()
    );
    expect(execPhoneTool).toHaveBeenCalledWith("read_screen", {}, expect.anything());
    expect(res.elements[0].text).toContain("Subject: Hello");
  });

  it("declines when the user does not confirm", async () => {
    const confirm = vi.fn(async () => false);
    const res = await gmailInbox({ confirm });
    expect(res.ok).toBe(false);
    expect(res.declined).toBe(true);
  });
});

describe("calendarEvents", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens the calendar app and reads the screen", async () => {
    const confirm = vi.fn(async () => true);
    const res = await calendarEvents({ confirm });
    expect(res.ok).toBe(true);
    expect(res.app).toBe("com.google.android.calendar");
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.calendar" },
      expect.anything()
    );
  });
});

describe("driveBrowse", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens Drive (docs) and reads the screen", async () => {
    const confirm = vi.fn(async () => true);
    const res = await driveBrowse({ confirm });
    expect(res.ok).toBe(true);
    expect(res.app).toBe("com.google.android.apps.docs");
  });

  it("falls back to Files when Drive fails to open", async () => {
    const confirm = vi.fn(async () => true);
    execPhoneTool.mockImplementationOnce(async (name) => {
      if (name === "open_app") return { ok: false, error: "open failed" };
      return { ok: true };
    });
    await driveBrowse({ confirm });
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.documentsui" },
      expect.anything()
    );
  });
});

describe("geminiQuery", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens Gemini, types the query, submits, and reads the answer", async () => {
    const confirm = vi.fn(async () => true);
    const res = await geminiQuery({ query: "what is 2+2", confirm });
    expect(res.ok).toBe(true);
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.apps.bard" },
      expect.anything()
    );
    expect(execPhoneTool).toHaveBeenCalledWith(
      "type",
      { text: "what is 2+2", submit: false },
      expect.anything()
    );
  });

  it("fails soft without a query", async () => {
    const res = await geminiQuery({ query: "", confirm: vi.fn(async () => true) });
    expect(res.ok).toBe(false);
  });
});

describe("youtubeSearch", () => {
  beforeEach(() => {
    execPhoneTool.mockClear();
  });

  it("opens YouTube and types the search query", async () => {
    const confirm = vi.fn(async () => true);
    const res = await youtubeSearch({ query: "lofi", confirm });
    expect(res.ok).toBe(true);
    expect(execPhoneTool).toHaveBeenCalledWith(
      "open_app",
      { package_name: "com.google.android.youtube" },
      expect.anything()
    );
    expect(execPhoneTool).toHaveBeenCalledWith("type", { text: "lofi", submit: false }, expect.anything());
  });
});

describe("runRecipe dispatch", () => {
  it("routes unknown names to a soft failure", async () => {
    const res = await runRecipe("nope", {}, {});
    expect(res.ok).toBe(false);
  });

  it("dispatches gmail_inbox", async () => {
    const confirm = vi.fn(async () => true);
    const res = await runRecipe("gmail_inbox", {}, { confirm });
    expect(res.ok).toBe(true);
  });
});
