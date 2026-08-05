import { describe, it, expect } from "vitest";
import {
  uuid,
  ts,
  STATUS_LABEL,
  STATUS_COLOR,
  formatUnread,
  getLastMessage,
  getUnreadCount,
  markAllSeen,
} from "./helpers.js";

describe("uuid", () => {
  it("generates unique values", () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) {
      const id = uuid();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(10);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const original = global.crypto?.randomUUID;
    try {
      Object.defineProperty(global.crypto, "randomUUID", { value: undefined, configurable: true });
      const id = uuid();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(10);
    } finally {
      if (original) {
        Object.defineProperty(global.crypto, "randomUUID", { value: original, configurable: true });
      }
    }
  });
});

describe("ts", () => {
  it("returns a formatted time string", () => {
    const time = ts();
    expect(typeof time).toBe("string");
    expect(time.length).toBeGreaterThan(0);
  });
});

describe("status metadata", () => {
  it("has a label and color for every status", () => {
    for (const status of Object.keys(STATUS_LABEL)) {
      expect(typeof STATUS_LABEL[status]).toBe("string");
      expect(typeof STATUS_COLOR[status]).toBe("string");
    }
  });
});

describe("formatUnread", () => {
  it("returns null for zero", () => {
    expect(formatUnread(0)).toBeNull();
  });

  it("returns the number under 10", () => {
    expect(formatUnread(3)).toBe("3");
  });

  it("caps at 9+", () => {
    expect(formatUnread(10)).toBe("9+");
    expect(formatUnread(999)).toBe("9+");
  });
});

describe("getLastMessage", () => {
  it("returns the last message for a bot", () => {
    const history = { a: [{ id: 1 }, { id: 2 }] };
    expect(getLastMessage(history, "a")).toEqual({ id: 2 });
  });

  it("returns null for missing bot", () => {
    expect(getLastMessage({}, "b")).toBeNull();
  });
});

describe("getUnreadCount", () => {
  it("counts unseen bot messages only", () => {
    const history = {
      a: [
        { role: "bot", _seen: true },
        { role: "bot", _seen: false },
        { role: "user", _seen: false },
        { role: "bot" },
      ],
    };
    expect(getUnreadCount(history, "a")).toBe(2);
  });
});

describe("markAllSeen", () => {
  it("marks all messages seen without mutating input", () => {
    const history = { a: [{ id: 1, _seen: false }, { id: 2 }] };
    const next = markAllSeen(history, "a");
    expect(next.a.every((m) => m._seen === true)).toBe(true);
    // Original untouched
    expect(history.a[1]._seen).toBeUndefined();
  });
});
