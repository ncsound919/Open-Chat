/**
 * Local notification helpers (Capacitor native only).
 * Falls back to a no-op on web/Electron — ntfy delivers the push itself there.
 */

import { isNative } from "./platform.js";

// Monotonically increasing id so two notifications in the same millisecond
// never collide (Date.now() % 100000 wraps and would replace the previous alert).
let notificationSeq = 0;

/**
 * Request permission to show local notifications.
 * Only meaningful on native platforms.
 * @returns {Promise<boolean>} true when permission is granted
 */
export async function requestNotificationPermission() {
  if (!isNative) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const result = await LocalNotifications.requestPermissions();
    return result.display === "granted";
  } catch {
    return false;
  }
}

/**
 * Show a local notification (native only). Uses a timestamp-derived id
 * so consecutive alerts never collide.
 * @param {string} title
 * @param {string} body
 */
export async function notifyLocal(title, body) {
  if (!isNative) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({
      notifications: [
        {
          id: (Date.now() % 100000) + notificationSeq++,
          title,
          body,
        },
      ],
    });
  } catch {
    // Non-fatal — ntfy already handles the foreground push
  }
}
