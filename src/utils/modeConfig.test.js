import { describe, it, expect } from "vitest";
import {
  MODES,
  isFieldVisible,
  getModeDefaults,
  getAvailableProtocols,
  getModeLabel,
} from "./modeConfig.js";

describe("modeConfig", () => {
  it("defines the mode constants", () => {
    expect(MODES.BASIC).toBe("basic");
    expect(MODES.DEV).toBe("dev");
  });

  describe("isFieldVisible", () => {
    it("hides dev-only fields in basic mode", () => {
      expect(isFieldVisible("protocol", "basic")).toBe(false);
      expect(isFieldVisible("host", "basic")).toBe(false);
      expect(isFieldVisible("port", "basic")).toBe(false);
      expect(isFieldVisible("token", "basic")).toBe(false);
      expect(isFieldVisible("voiceEnabled", "basic")).toBe(false);
    });

    it("shows dev-only fields in dev mode", () => {
      expect(isFieldVisible("protocol", "dev")).toBe(true);
      expect(isFieldVisible("host", "dev")).toBe(true);
      expect(isFieldVisible("token", "dev")).toBe(true);
      expect(isFieldVisible("toolLogs", "dev")).toBe(true);
    });

    it("shows statusIndicator in basic mode", () => {
      expect(isFieldVisible("statusIndicator", "basic")).toBe(true);
      expect(isFieldVisible("statusIndicator", "dev")).toBe(true);
    });

    it("returns true for unknown fields", () => {
      expect(isFieldVisible("notAConfiguredField", "basic")).toBe(true);
      expect(isFieldVisible("notAConfiguredField", "dev")).toBe(true);
    });
  });

  describe("getModeDefaults", () => {
    it("returns the hermes/127.0.0.1/8642 defaults for basic mode", () => {
      expect(getModeDefaults(MODES.BASIC)).toEqual({
        protocol: "hermes",
        host: "127.0.0.1",
        port: 8642,
        token: "",
      });
    });

    it("returns an empty object for dev mode", () => {
      expect(getModeDefaults(MODES.DEV)).toEqual({});
    });
  });

  describe("getAvailableProtocols", () => {
    it("returns only hermes in basic mode", () => {
      expect(getAvailableProtocols(MODES.BASIC)).toEqual(["hermes"]);
    });

    it("returns all six protocols in dev mode", () => {
      expect(getAvailableProtocols(MODES.DEV)).toEqual([
        "hermes",
        "openclaw",
        "uplift-bridge",
        "subteam",
        "draymond",
        "ntfy",
      ]);
    });
  });

  describe("getModeLabel", () => {
    it("returns the display labels", () => {
      expect(getModeLabel(MODES.BASIC)).toBe("Basic");
      expect(getModeLabel(MODES.DEV)).toBe("Dev");
    });
  });
});
