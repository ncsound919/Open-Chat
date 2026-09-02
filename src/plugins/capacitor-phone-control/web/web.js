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

/** Web fallback: browser speech synthesis (native Android uses system TTS). */
export async function speak({ text, rate = 1.0, pitch = 1.0 } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return { ok: false, error: "speechSynthesis unavailable" };
  }
  if (!text?.trim()) return { ok: false, error: "text required" };
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.pitch = pitch;
  window.speechSynthesis.speak(u);
  return { ok: true };
}

export async function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  return { ok: true };
}

/** Web fallback: no native STT on web — return unavailable error. */
export async function startSpeechRecognition({ language, prompt } = {}) {
  return { ok: false, error: "speech recognition requires the native Android plugin" };
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
  speak,
  stopSpeaking,
  startSpeechRecognition,
};

export default PhoneControlWeb;
