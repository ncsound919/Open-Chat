import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildVoiceEndpoint,
  float32ToInt16,
  downsample,
  pcmToBytes,
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
});
