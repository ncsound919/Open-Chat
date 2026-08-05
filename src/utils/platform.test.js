import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_UA = window.navigator.userAgent;

/**
 * Load platform.js with a stubbed @capacitor/core and a specific user agent.
 * The module evaluates once, so we reset modules + re-import per scenario.
 */
async function loadPlatform(capacitorImpl, userAgent) {
  vi.resetModules();
  vi.doMock("@capacitor/core", () => ({ Capacitor: capacitorImpl }));
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  return await import("./platform.js");
}

function nativeCapacitor(platform) {
  return {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
}

function webCapacitor() {
  return {
    isNativePlatform: () => false,
    getPlatform: () => "web",
  };
}

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ORIGINAL_UA,
    configurable: true,
  });
  vi.doUnmock("@capacitor/core");
});

describe("platform", () => {
  it("detects native Android via Capacitor", async () => {
    const mod = await loadPlatform(nativeCapacitor("android"), "Mozilla/5.0 (Linux)");
    expect(mod.isNative).toBe(true);
    expect(mod.platform).toBe("android");
    expect(mod.isAndroid).toBe(true);
    expect(mod.isIOS).toBe(false);
    expect(mod.isElectron).toBe(false);
    expect(mod.isWeb).toBe(false);
    expect(mod.getPlatformLabel()).toBe("Android");
  });

  it("detects native iOS via Capacitor", async () => {
    const mod = await loadPlatform(nativeCapacitor("ios"), "Mozilla/5.0 (iPhone)");
    expect(mod.isNative).toBe(true);
    expect(mod.platform).toBe("ios");
    expect(mod.isIOS).toBe(true);
    expect(mod.isAndroid).toBe(false);
    expect(mod.isWeb).toBe(false);
    expect(mod.getPlatformLabel()).toBe("iOS");
  });

  it("detects Electron desktop via the user agent", async () => {
    const mod = await loadPlatform(
      webCapacitor(),
      "Mozilla/5.0 ... Electron/33.0.0 Chrome/128.0"
    );
    expect(mod.isNative).toBe(false);
    expect(mod.isElectron).toBe(true);
    expect(mod.isWeb).toBe(false);
    expect(mod.getPlatformLabel()).toBe("Desktop");
  });

  it("detects plain web when not native and not Electron", async () => {
    const mod = await loadPlatform(webCapacitor(), "Mozilla/5.0 (Windows NT 10.0) Chrome");
    expect(mod.isNative).toBe(false);
    expect(mod.isElectron).toBe(false);
    expect(mod.isWeb).toBe(true);
    expect(mod.getPlatformLabel()).toBe("Web");
  });
});
