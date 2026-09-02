import { describe, it, expect } from "vitest";
import {
  parseMcpServers,
  summarizeMcpTools,
} from "./mcpConfig.js";

describe("parseMcpServers", () => {
  it("parses a JSON array string", () => {
    const raw = JSON.stringify([
      { name: "s1", url: "http://127.0.0.1:8000", token: "tok" },
      { name: "s2", url: "https://mcp.example.com" },
    ]);
    expect(parseMcpServers(raw)).toEqual([
      { name: "s1", url: "http://127.0.0.1:8000", token: "tok" },
      { name: "s2", url: "https://mcp.example.com", token: "" },
    ]);
  });

  it("accepts an already-parsed array", () => {
    expect(parseMcpServers([{ name: "a", url: "http://x" }])).toEqual([
      { name: "a", url: "http://x", token: "" },
    ]);
  });

  it("filters entries missing name or url", () => {
    const raw = JSON.stringify([
      { name: "ok", url: "http://x" },
      { name: "", url: "http://y" },
      { url: "http://z" },
    ]);
    expect(parseMcpServers(raw)).toEqual([{ name: "ok", url: "http://x", token: "" }]);
  });

  it("returns an empty array for blank or invalid input", () => {
    expect(parseMcpServers("")).toEqual([]);
    expect(parseMcpServers(null)).toEqual([]);
    expect(parseMcpServers("not json")).toEqual([]);
    expect(parseMcpServers("{}")).toEqual([]);
  });
});

describe("summarizeMcpTools", () => {
  it("builds a human-readable summary", () => {
    expect(summarizeMcpTools({ s1: ["a", "b"], s2: [] })).toBe("s1 (2), s2 (0)");
  });

  it("handles no servers", () => {
    expect(summarizeMcpTools({})).toBe("No servers connected");
  });
});
