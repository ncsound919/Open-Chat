import { describe, it, expect, vi, beforeEach } from "vitest";

// notifications.js imports platform.js; on web isNative is false,
// so notifyLocal/requestNotificationPermission are no-ops.
import {
  notifyLocal,
  requestNotificationPermission,
} from "./notifications.js";

describe("notifications (web fallback)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("notifyLocal is a no-op on web", async () => {
    const result = await notifyLocal("Title", "Body");
    expect(result).toBeUndefined();
  });

  it("requestNotificationPermission returns false on web", async () => {
    const granted = await requestNotificationPermission();
    expect(granted).toBe(false);
  });
});

describe("notifications (native Capacitor)", () => {
  // notifications.js reads isNative at import time. Re-import the module with a
  // stubbed platform module so the native branch is exercised.
  async function loadNativeModule() {
    vi.resetModules();
    vi.doMock("./platform.js", () => ({ isNative: true }));
    return await import("./notifications.js");
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("./platform.js");
    vi.doUnmock("@capacitor/local-notifications");
  });

  it("requestNotificationPermission returns true when granted", async () => {
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        requestPermissions: async () => ({ display: "granted" }),
      },
    }));
    const mod = await loadNativeModule();
    await expect(mod.requestNotificationPermission()).resolves.toBe(true);
  });

  it("requestNotificationPermission returns false when denied", async () => {
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        requestPermissions: async () => ({ display: "denied" }),
      },
    }));
    const mod = await loadNativeModule();
    await expect(mod.requestNotificationPermission()).resolves.toBe(false);
  });

  it("requestNotificationPermission returns false when the call throws", async () => {
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        requestPermissions: async () => {
          throw new Error("bridge unavailable");
        },
      },
    }));
    const mod = await loadNativeModule();
    await expect(mod.requestNotificationPermission()).resolves.toBe(false);
  });

  it("notifyLocal schedules a timestamp-id notification", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: { schedule },
    }));
    const mod = await loadNativeModule();

    await mod.notifyLocal("New message", "Agent replied");

    expect(schedule).toHaveBeenCalledTimes(1);
    const [arg] = schedule.mock.calls[0];
    expect(arg.notifications).toHaveLength(1);
    const notification = arg.notifications[0];
    expect(notification.title).toBe("New message");
    expect(notification.body).toBe("Agent replied");
    expect(notification.id).toBeGreaterThanOrEqual(0);
    expect(notification.id).toBeLessThan(100000);
  });

  it("notifyLocal swallows schedule errors (non-fatal)", async () => {
    const schedule = vi.fn(async () => {
      throw new Error("native not ready");
    });
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: { schedule },
    }));
    const mod = await loadNativeModule();
    await expect(mod.notifyLocal("T", "B")).resolves.toBeUndefined();
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
