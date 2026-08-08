/**
 * Web fallback for PhoneControl. On non-native platforms the plugin does
 * nothing useful — the web build is a no-op that returns safe defaults so
 * the app still renders and tests pass.
 */

export async function getStatus() {
  return { enabled: false, available: false };
}

export async function listApps() {
  return { apps: [] };
}

export async function openAccessibilitySettings() {
  return { ok: false };
}

export async function getForegroundApp() {
  return { packageName: "", className: "" };
}

export async function readScreen() {
  return { foregroundPackage: "", foregroundClass: "", nodes: [] };
}

export async function performTap() {
  return { ok: false, error: "phone-control unavailable on web" };
}

export async function inputText() {
  return { ok: false, error: "phone-control unavailable on web" };
}

export async function performGlobalAction() {
  return { ok: false, error: "phone-control unavailable on web" };
}

export async function openApp() {
  return { ok: false, error: "phone-control unavailable on web" };
}

export async function swipe() {
  return { ok: false, error: "phone-control unavailable on web" };
}

export async function screenshot() {
  return { ok: false, error: "phone-control unavailable on web" };
}

const PhoneControlWeb = {
  getStatus,
  listApps,
  openAccessibilitySettings,
  getForegroundApp,
  readScreen,
  performTap,
  inputText,
  performGlobalAction,
  openApp,
  swipe,
  screenshot,
};

export default PhoneControlWeb;
