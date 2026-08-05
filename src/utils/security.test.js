import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sanitizeText,
  isLocalhost,
  isSafeUrl,
  resolveEndpoint,
  maskToken,
  isValidMessageSize,
  safeLog,
  MAX_MESSAGE_BYTES,
} from "./security.js";

describe("sanitizeText", () => {
  it("returns an empty string for non-string input", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(42)).toBe("");
  });

  it("strips <script> blocks", () => {
    const out = sanitizeText("Hello <script>alert('xss')</script>world");
    expect(out).not.toContain("script");
    expect(out).toBe("Hello world");
  });

  it("strips inline event-handler attributes", () => {
    const out = sanitizeText('<img src="x" onerror="evil()">');
    expect(out).not.toContain("onerror");
  });

  it("strips javascript: URI schemes", () => {
    expect(sanitizeText('click <a href="javascript:alert(1)">here</a>')).not.toContain(
      "javascript:"
    );
  });

  it("strips data: URIs in href/src", () => {
    expect(sanitizeText('<a href="data:text/html,<script>">x</a>')).not.toContain(
      "data:"
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeText("just normal prose **bolded**")).toBe(
      "just normal prose **bolded**"
    );
  });
});

describe("isLocalhost", () => {
  it("accepts common loopback values (case-insensitive, trimmed)", () => {
    expect(isLocalhost("127.0.0.1")).toBe(true);
    expect(isLocalhost("localhost")).toBe(true);
    expect(isLocalhost("::1")).toBe(true);
    expect(isLocalhost(" LOCALHOST ")).toBe(true);
  });

  it("rejects remote/LAN hosts and garbage input", () => {
    expect(isLocalhost("agents.example.com")).toBe(false);
    expect(isLocalhost("192.168.1.10")).toBe(false);
    expect(isLocalhost("")).toBe(false);
    expect(isLocalhost(null)).toBe(false);
  });
});

describe("isSafeUrl", () => {
  it("allows http/https/ws/wss", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isSafeUrl("wss://example.com/socket")).toBe(true);
  });

  it("rejects dangerous schemes", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isSafeUrl("not a url")).toBe(false);
  });
});

describe("resolveEndpoint", () => {
  it("keeps full URLs as-is (strips trailing slash)", () => {
    expect(resolveEndpoint("https://tunnel.example.com", 8080)).toBe(
      "https://tunnel.example.com"
    );
    expect(resolveEndpoint("https://tunnel.example.com/")).toBe(
      "https://tunnel.example.com"
    );
  });

  it("uses insecure schemes for localhost", () => {
    expect(resolveEndpoint("127.0.0.1", 3000)).toBe("http://127.0.0.1:3000");
    expect(resolveEndpoint("localhost", 8080, "ws")).toBe("ws://localhost:8080");
  });

  it("escalates remote hosts to secure schemes", () => {
    expect(resolveEndpoint("agents.example.com", 443)).toBe(
      "https://agents.example.com:443"
    );
    expect(resolveEndpoint("192.168.0.5", 9000, "ws")).toBe(
      "wss://192.168.0.5:9000"
    );
  });

  it("omits port when absent", () => {
    expect(resolveEndpoint("127.0.0.1")).toBe("http://127.0.0.1");
    expect(resolveEndpoint("agents.example.com")).toBe("https://agents.example.com");
  });

  it("handles a missing/empty host by falling through to a secure empty endpoint", () => {
    expect(resolveEndpoint("")).toBe("https://");
    expect(resolveEndpoint(null, 8080)).toBe("https://:8080");
  });
});

describe("maskToken", () => {
  it("returns empty for blank input", () => {
    expect(maskToken("")).toBe("");
    expect(maskToken("   ")).toBe("");
    expect(maskToken()).toBe("");
    expect(maskToken(null)).toBe("");
  });

  it("masks short tokens entirely", () => {
    expect(maskToken("abcd")).toBe("••••");
  });

  it("keeps last 4 chars", () => {
    expect(maskToken("secret_key_12345")).toBe("••••••••••••2345");
    expect(maskToken("abc12345").endsWith("2345")).toBe(true);
  });
});

describe("isValidMessageSize", () => {
  it("accepts payloads within the limit", () => {
    expect(isValidMessageSize("hello")).toBe(true);
    expect(isValidMessageSize("x".repeat(MAX_MESSAGE_BYTES))).toBe(true);
  });

  it("rejects payloads over the limit", () => {
    expect(isValidMessageSize("x".repeat(MAX_MESSAGE_BYTES + 1))).toBe(false);
  });

  it("rejects non-string payloads", () => {
    expect(isValidMessageSize(null)).toBe(false);
    expect(isValidMessageSize(123)).toBe(false);
  });
});

describe("safeLog", () => {
  let spy;

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("redacts bearer tokens from error messages", () => {
    const err = new Error("request failed: Bearer sk-1234567890");
    safeLog("connect", err);
    expect(spy).toHaveBeenCalled();
    const msg = spy.mock.calls[0][1];
    expect(msg).toContain("Bearer [REDACTED]");
    expect(msg).not.toContain("sk-1234567890");
  });

  it("redacts token=/key=/password= values", () => {
    safeLog("cfg", new Error("token=abc123 key=p4ssw0rd"));
    const msg = spy.mock.calls[0][1];
    expect(msg).not.toContain("abc123");
    expect(msg).not.toContain("p4ssw0rd");
    expect(msg).toContain("token=[REDACTED]");
  });

  it("handles non-Error values", () => {
    expect(() => safeLog("cfg", "boom")).not.toThrow();
    expect(() => safeLog("cfg", undefined)).not.toThrow();
  });
});