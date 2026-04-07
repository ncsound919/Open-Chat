/**
 * Platform detection utility
 * Detects whether we're running in Capacitor (Android/iOS), Electron, or plain web.
 */

import { Capacitor } from '@capacitor/core';

/** True when running inside the Capacitor native shell (Android or iOS) */
export const isNative = Capacitor.isNativePlatform();

/** "android" | "ios" | "web" */
export const platform = Capacitor.getPlatform();

/** True when running on Android */
export const isAndroid = platform === 'android';

/** True when running on iOS */
export const isIOS = platform === 'ios';

/** True when running inside Electron (desktop) */
export const isElectron =
  typeof navigator !== 'undefined' &&
  /electron/i.test(navigator.userAgent);

/** True when running in a plain browser (not native, not Electron) */
export const isWeb = !isNative && !isElectron;

/**
 * Returns a human-readable platform label.
 */
export function getPlatformLabel() {
  if (isAndroid) return 'Android';
  if (isIOS) return 'iOS';
  if (isElectron) return 'Desktop';
  return 'Web';
}
