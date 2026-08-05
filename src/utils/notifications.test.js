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
