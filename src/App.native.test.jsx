import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

// Mock native platform so the isNative-only effects in App run.
vi.mock("./utils/platform.js", () => ({
  isNative: true,
  platform: "android",
  isAndroid: true,
  isIOS: false,
  isElectron: false,
  isWeb: false,
  getPlatformLabel: () => "Android",
}));

const appListeners = {};
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (event, cb) => {
      appListeners[event] = cb;
      return { remove: vi.fn(() => { delete appListeners[event]; }) };
    }),
  },
}));

const networkListeners = {};
vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: vi.fn(async (event, cb) => {
      networkListeners[event] = cb;
      return { remove: vi.fn(() => { delete networkListeners[event]; }) };
    }),
  },
}));

const flushOfflineQueue = vi.fn();
vi.mock("./protocols/DraymondOrchestratorClient.js", () => ({
  DraymondOrchestratorClient: vi.fn(function () {
    this.status = "connected";
    this.connect = vi.fn(async () => {});
    this.disconnect = vi.fn();
    this.flushOfflineQueue = flushOfflineQueue;
    this.orchestrate = vi.fn();
    this.listChains = vi.fn();
    this.listSchedules = vi.fn();
    this.executeChain = vi.fn();
    this.toggleSchedule = vi.fn();
  }),
}));
vi.mock("./protocols/HermesClient.js", () => ({
  hermesStream: vi.fn(async () => ""),
  hermesHealthCheck: vi.fn(async () => true),
}));
vi.mock("./protocols/OpenClawClient.js", () => ({
  OpenClawClient: vi.fn(function () {
    this.ws = { readyState: 1 };
    this.send = vi.fn();
    this.connect = vi.fn(async () => {});
    this.disconnect = vi.fn();
  }),
}));
vi.mock("./protocols/UpliftBridgeClient.js", () => ({
  UpliftBridgeClient: vi.fn(function () {
    this.sessionId = "s";
    this.send = vi.fn();
    this.connect = vi.fn(async () => {});
    this.disconnect = vi.fn();
  }),
}));
vi.mock("./protocols/SubTeamClient.js", () => ({
  subTeamStream: vi.fn(async () => ""),
  subTeamHealthCheck: vi.fn(async () => true),
}));
vi.mock("./protocols/NtfyClient.js", () => ({
  NtfyClient: vi.fn(function () {
    this.status = "connected";
    this.connect = vi.fn(async () => {});
    this.disconnect = vi.fn();
    this.publish = vi.fn();
    this.executeAction = vi.fn();
  }),
}));
vi.mock("./hooks/useVoice.js", () => ({
  useVoice: vi.fn(() => ({
    micActive: false,
    speakEnabled: false,
    micError: null,
    setSpeakEnabled: vi.fn(),
    startListening: vi.fn(),
    stopAndTranscribe: vi.fn(),
    cancelListening: vi.fn(),
    speak: vi.fn(),
  })),
}));

const requestNotificationPermission = vi.fn(async () => "granted");
vi.mock("./utils/notifications.js", () => ({
  notifyLocal: vi.fn(async () => {}),
  requestNotificationPermission: () => requestNotificationPermission(),
}));

import App from "./App.jsx";
import { DraymondOrchestratorClient } from "./protocols/DraymondOrchestratorClient.js";

const CONF = "openchat_conf_v1";
const HIST = "openchat_hist_v1";

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  localStorage.setItem(CONF, JSON.stringify([
    { id: "draymond", name: "Draymond", protocol: "draymond", host: "127.0.0.1", port: 8644, token: "" },
  ]));
  localStorage.setItem(HIST, JSON.stringify({}));
  flushOfflineQueue.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("App native effects", () => {
  it("requests notification permission on mount when native", async () => {
    render(<App />);
    await flushPromises();
    expect(requestNotificationPermission).toHaveBeenCalled();
  });

  it("registers and triggers the Android back button handler", async () => {
    const { unmount } = render(<App />);
    await flushPromises();
    expect(appListeners.backButton).toBeDefined();

    // Fire the back button while at the inbox level — no crash, no active chat.
    await act(async () => {
      appListeners.backButton();
    });
    unmount();
    expect(appListeners.backButton).toBeUndefined();
  });

  it("flushes Draymond offline queues when the network is restored", async () => {
    render(<App />);
    await flushPromises();
    expect(networkListeners.networkStatusChange).toBeDefined();

    await act(async () => {
      networkListeners.networkStatusChange({ connected: true });
    });
    expect(flushOfflineQueue).toHaveBeenCalled();
  });

  it("does not flush offline queues when network disconnects", async () => {
    render(<App />);
    await flushPromises();
    await act(async () => {
      networkListeners.networkStatusChange({ connected: false });
    });
    expect(flushOfflineQueue).not.toHaveBeenCalled();
  });

  it("sets up a Draymond client that is connected", async () => {
    render(<App />);
    await flushPromises();
    const dray = DraymondOrchestratorClient.mock.instances[0];
    expect(dray.connect).toHaveBeenCalled();
  });
});
