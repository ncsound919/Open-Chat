import { describe, it, expect, vi } from "vitest";
import {
  buildVoiceEndpoint,
  float32ToInt16,
  downsample,
  pcmToBytes,
  transcribeAudio,
} from "./voice.js";

describe("buildVoiceEndpoint", () => {
  it("builds Draymond backend URLs", () => {
    expect(buildVoiceEndpoint("draymond", "127.0.0.1", 3000, "transcribe")).toBe(
      "http://127.0.0.1:3000/api/v1/voice/transcribe"
    );
    expect(buildVoiceEndpoint("draymond", "example.com", null, "synthesize")).toBe(
      "https://example.com/api/v1/voice/synthesize"
    );
  });

  it("builds AetherDesk backend URLs", () => {
    expect(buildVoiceEndpoint("aetherdesk", "127.0.0.1", 8000, "transcribe")).toBe(
      "http://127.0.0.1:8000/api/v1/voice/transcribe"
    );
    expect(buildVoiceEndpoint("aetherdesk", null, null, "synthesize")).toBe(
      "http://127.0.0.1:8000/api/v1/voice/synthesize"
    );
  });
});

describe("PCM conversion", () => {
  it("downsamples to the target sample rate", () => {
    const input = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const out = downsample(input, 16000, 8000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(0.25, 5); // decimation picks indices 0 and 2
  });

  it("converts float32 to int16 PCM bytes", () => {
    const bytes = float32ToInt16(new Float32Array([1, 0, -1]));
    expect(bytes.length).toBe(6); // 3 samples * 2 bytes
    expect(bytes[0]).toBe(0xff); // 32767 low byte
    expect(bytes[1]).toBe(0x7f); // 32767 high byte
    expect(bytes[4]).toBe(0x00); // -32768 low byte (two's complement)
    expect(bytes[5]).toBe(0x80); // -32768 high byte
  });

  it("pcmToBytes resamples mono 16kHz int16", () => {
    const bytes = pcmToBytes(new Float32Array([0.5, -0.5]), 48000);
    // 2 samples at 48k downsampled to 16k = ceil(2/3) = 1 sample
    expect(bytes.length).toBe(2);
  });

  it("downsample guards against zero or invalid rates", () => {
    const input = new Float32Array([0.5, -0.5]);
    expect(downsample(input, 0, 16000)).toBe(input);
    expect(downsample(input, 16000, 0)).toBe(input);
    expect(downsample(input, -1, 16000)).toBe(input);
    expect(downsample(input, null, 16000)).toBe(input);
  });
});

describe("transcribeAudio", () => {
  it("transcribeAudio converts PCM and posts to the endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "hello" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeAudio(new Float32Array([1, 0, -1]), 48000, "aetherdesk", null, null, null, "key");
    expect(result).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8000/api/v1/voice/transcribe");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(Uint8Array);
    vi.unstubAllGlobals();
  });

  it("transcribeAudio posts converted int16 bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(new Float32Array([1, 0, -1]), 48000, "aetherdesk", null, null, null, "key");
    const [, init] = fetchMock.mock.calls[0];
    // 3 samples at 48k -> 1 sample at 16k -> 2 bytes int16
    expect(init.body.length).toBe(2);
    vi.unstubAllGlobals();
  });
});
