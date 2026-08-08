import { describe, it, expect, vi } from "vitest";
import {
  APP_CATEGORIES,
  categorizeApp,
  discoverApps,
  buildAppContext,
  summarizeCapabilities,
} from "./appRegistry.js";

vi.mock("./modelRegistry.js", () => ({
  loadPhoneControl: vi.fn(async () => null),
}));

const APPS = [
  { packageName: "com.facebook.orca", label: "Messenger" },
  { packageName: "com.coinbase.android", label: "Coinbase" },
  { packageName: "com.anthropic.claude", label: "Claude" },
  { packageName: "com.google.android.apps.docs", label: "Docs" },
  { packageName: "com.suno.android", label: "Suno" },
  { packageName: "com.ubercab", label: "Uber" },
  { packageName: "com.einnovation.temu", label: "Temu" },
  { packageName: "com.zjw.apps3pluspro", label: "Health Tracker" },
  { packageName: "com.whatever.thing", label: "Mystery" },
];

describe("categorizeApp", () => {
  it("routes apps to capability buckets", () => {
    expect(categorizeApp(APPS[0])).toBe("messaging");
    expect(categorizeApp(APPS[1])).toBe("finance");
    expect(categorizeApp(APPS[2])).toBe("ai");
    expect(categorizeApp(APPS[3])).toBe("productivity");
    expect(categorizeApp(APPS[4])).toBe("media");
    expect(categorizeApp(APPS[5])).toBe("transport");
    expect(categorizeApp(APPS[6])).toBe("shopping");
    expect(categorizeApp(APPS[7])).toBe("health");
    expect(categorizeApp(APPS[8])).toBe("other");
  });
});

describe("discoverApps", () => {
  it("returns empty when no bridge", async () => {
    const r = await discoverApps({ phoneControl: null });
    expect(r.count).toBe(0);
    expect(r.available).toBe(false);
  });

  it("categorizes discovered apps", async () => {
    const phone = { listApps: vi.fn(async () => ({ apps: APPS })) };
    const r = await discoverApps({ phoneControl: phone });
    expect(r.count).toBe(APPS.length);
    expect(r.byCategory.messaging.length).toBe(1);
    expect(r.byCategory.finance[0].risk).toBe("high");
  });

  it("handles listApps errors", async () => {
    const phone = { listApps: vi.fn(async () => { throw new Error("x"); }) };
    const r = await discoverApps({ phoneControl: phone });
    expect(r.available).toBe(false);
  });
});

describe("buildAppContext", () => {
  it("builds a prompt section from apps", async () => {
    const { apps } = await discoverApps({ phoneControl: { listApps: vi.fn(async () => ({ apps: APPS })) } });
    const ctx = buildAppContext(apps);
    expect(ctx).toContain("APPS ON THIS PHONE");
    expect(ctx).toContain("Messenger");
    expect(ctx).toContain("com.coinbase.android");
    expect(ctx).toContain("READ-ONLY");
  });

  it("returns empty with no apps", () => {
    expect(buildAppContext([])).toBe("");
  });
});

describe("summarizeCapabilities", () => {
  it("summarizes buckets", async () => {
    const { apps } = await discoverApps({ phoneControl: { listApps: vi.fn(async () => ({ apps: APPS })) } });
    const buckets = summarizeCapabilities(apps);
    expect(buckets.some((b) => b.key === "finance" && b.count === 1)).toBe(true);
    expect(buckets.some((b) => b.key === "other")).toBe(true);
  });
});

describe("APP_CATEGORIES", () => {
  it("has all expected categories", () => {
    const keys = APP_CATEGORIES.map((c) => c.key);
    for (const k of ["messaging", "finance", "ai", "productivity", "media", "transport", "shopping", "health", "other"]) {
      expect(keys).toContain(k);
    }
  });
});
