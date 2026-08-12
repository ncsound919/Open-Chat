import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Open Chat — Capacitor configuration.
 *
 * webContentsDebuggingEnabled is gated on CAP_DEBUG so release APKs never
 * ship with Chrome remote debugging (adb can otherwise read app data). To
 * debug a local build:
 *   Windows:  $env:CAP_DEBUG="1"; npx cap sync android
 *   macOS/Linux: CAP_DEBUG=1 npx cap sync android
 */
const config: CapacitorConfig = {
  appId: "com.openchat.app",
  appName: "Open Chat",
  webDir: "dist",
  plugins: {
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0d0d14",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      iconColor: "#818cf8",
    },
  },
  android: {
    webContentsDebuggingEnabled: process.env.CAP_DEBUG === "1",
  },
};

export default config;
