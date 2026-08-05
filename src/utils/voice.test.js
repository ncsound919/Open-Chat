import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildVoiceEndpoint,
  float32ToInt16,
  downsample,
  pcmToBytes,
  transcribeAudio,
  synthesizeAndPlay,
  captureAudio,
  resolveCapture,
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

  it("uses a custom base URL for AetherDesk when provided", () => {
    expect(
      buildVoiceEndpoint("aetherdesk", "127.0.0.1", 8000, "transcribe", "https://voice.example.com/api/v1/")
    ).toBe("https://voice.example.com/api/v1/voice/transcribe");
    expect(
      buildVoiceEndpoint("aetherdesk", null, null, "synthesize", "https://voice.example.com")
    ).toBe("https://voice.example.com/voice/synthesize");
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

  it("pcmToBytes short-circuits empty input", () => {
    expect(pcmToBytes(new Float32Array(0), 48000).length).toBe(0);
    expect(pcmToBytes(null, 48000).length).toBe(0);
    expect(pcmToBytes(undefined, 48000).length).toBe(0);
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

describe("resolveCapture", () => {
  it("resolveCapture stops before awaiting done", async () => {
    const stop = vi.fn();
    const done = Promise.resolve({ audioData: new Float32Array([0]), sampleRate: 16000 });
    const cap = { stop, done };
    const result = await resolveCapture(cap);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.audioData.length).toBe(1);
  });

  it("resolveCapture returns null when no capture", async () => {
    expect(await resolveCapture(null)).toBeNull();
    expect(await resolveCapture(undefined)).toBeNull();
  });
});

describe("buildVoiceEndpoint edge cases", () => {
  it("wraps IPv6 localhost in brackets", () => {
    expect(buildVoiceEndpoint("draymond", "::1", 3000, "transcribe")).toBe(
      "http://[::1]:3000/api/v1/voice/transcribe"
    );
  });

  it("uses a full URL for draymond as-is", () => {
    expect(buildVoiceEndpoint("draymond", "https://voice.example.com", 9999, "transcribe")).toBe(
      "https://voice.example.com/api/v1/voice/transcribe"
    );
  });

  it("defaults draymond port to 3000 for localhost", () => {
    expect(buildVoiceEndpoint("draymond", "localhost", null, "synthesize")).toBe(
      "http://localhost:3000/api/v1/voice/synthesize"
    );
  });

  it("prefers https for remote draymond hosts regardless of port", () => {
    expect(buildVoiceEndpoint("draymond", "remote.example.com", 8644, "transcribe")).toBe(
      "https://remote.example.com/api/v1/voice/transcribe"
    );
  });
});

describe("PCM conversion edge cases", () => {
  it("downsample returns input unchanged when rates match", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(downsample(input, 16000, 16000)).toBe(input);
  });

  it("downsample supports upsampling", () => {
    const input = new Float32Array([0.5, -0.5]);
    const out = downsample(input, 8000, 16000);
    expect(out.length).toBeGreaterThan(input.length);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });

  it("float32ToInt16 clamps out-of-range values", () => {
    const bytes = float32ToInt16(new Float32Array([1.5, -1.5]));
    expect(bytes[1]).toBe(0x7f);
    expect(bytes[3]).toBe(0x80);
  });

  it("pcmToBytes downmixes an AudioBuffer-like stereo input", () => {
    const audioData = {
      numberOfChannels: 2,
      length: 4,
      getChannelData: vi.fn((ch) => ch === 0 ? new Float32Array([1, 0, 1, 0]) : new Float32Array([0, 1, 0, 1])),
    };
    const bytes = pcmToBytes(audioData, 16000);
    expect(bytes.length).toBe(4 * 2);
    // First sample average (1 + 0) / 2 = 0.5 → int16 ≈ 16383 (0x3FFF)
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0x3f);
  });
});

describe("transcribeAudio headers and errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds a Bearer token for the draymond backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "hi" }) });
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(new Float32Array([1]), 48000, "draymond", "127.0.0.1", 3000, "tok123");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok123");
  });

  it("adds an x-api-key for the aetherdesk backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "" }) });
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(new Float32Array([1]), 48000, "aetherdesk", null, null, null, "akey");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("akey");
  });

  it("returns empty string when the response has no text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(new Float32Array([1]), 48000, "aetherdesk")).toBe("");
  });

  it("throws on a non-ok transcribe response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      transcribeAudio(new Float32Array([1]), 48000, "aetherdesk")
    ).rejects.toThrow("Transcribe failed: HTTP 500");
  });
});

describe("synthesizeAndPlay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    global.Audio = class {
      constructor(src) { this.src = src; }
      play = vi.fn().mockResolvedValue();
      pause = vi.fn();
    };
    global.URL.createObjectURL = vi.fn(() => "blob:audio");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("synthesizes with aetherdesk apiKey header and attaches base64 audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audio: "QUFBQQ==" }), // base64 "AAAA"
    });
    vi.stubGlobal("fetch", fetchMock);
    const audio = await synthesizeAndPlay("hello", "aetherdesk", null, null, null, "akey");
    expect(audio).toBeInstanceOf(global.Audio);
    expect(audio.play).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8000/api/v1/voice/synthesize");
    expect(init.headers["x-api-key"]).toBe("akey");
    expect(init.body).toBe('{"text":"hello"}');
  });

  it("adds a Bearer token for the draymond backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audio: "QUFBQQ==" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await synthesizeAndPlay("hi", "draymond", "127.0.0.1", 3000, "tok456");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok456");
  });

  it("throws on a non-ok synthesize response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(synthesizeAndPlay("hi", "aetherdesk")).rejects.toThrow("Synthesize failed: HTTP 503");
  });

  it("throws when the response contains no audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(synthesizeAndPlay("hi", "aetherdesk")).rejects.toThrow("Synthesize returned no audio");
  });

  it("revokes the object URL when playback fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audio: "QUFBQQ==" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    global.Audio = class {
      constructor(src) { this.src = src; }
      play = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
      pause = vi.fn();
    };
    await expect(synthesizeAndPlay("hi", "aetherdesk")).rejects.toThrow("autoplay blocked");
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  });
});

describe("captureAudio", () => {
  /** Helper to build a script-processor audio capture from an AudioContext mock. */
  function setupFakeAudioContext() {
    let recorderRef;
    class FakeAudioContext {
      constructor() {
        this.sampleRate = 48000;
        this.destination = { __tag: "destination" };
      }
      createMediaStreamSource(stream) {
        return { connect: vi.fn(), disconnect: vi.fn(), stream };
      }
      createScriptProcessor() {
        const rec = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null,
        };
        recorderRef = rec;
        return rec;
      }
      createGain() {
        return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
      }
      close() {}
    }
    return { FakeAudioContext, getRecorder: () => recorderRef };
  }

  it("records Float32 PCM and resolves a merged buffer on stop", async () => {
    const { FakeAudioContext, getRecorder } = setupFakeAudioContext();
    window.AudioContext = FakeAudioContext;

    const stream = { active: true };
    const cap = await captureAudio(stream);
    expect(typeof cap.stop).toBe("function");

    const rec = getRecorder();
    // Simulate two audio process callbacks
    rec.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0.5, -0.5]) } });
    rec.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([1, 0]) } });

    cap.stop();
    const result = await cap.done;
    expect(result.sampleRate).toBe(48000);
    expect(Array.from(result.audioData)).toEqual([0.5, -0.5, 1, 0]);
  });

  it("uses webkitAudioContext when AudioContext is unavailable", async () => {
    const { FakeAudioContext, getRecorder } = setupFakeAudioContext();
    delete window.AudioContext;
    window.webkitAudioContext = FakeAudioContext;

    const cap = await captureAudio({});
    const rec = getRecorder();
    rec.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0.2]) } });
    cap.stop();
    expect((await cap.done).audioData[0]).toBeCloseTo(0.2, 5);
  });

  it("returns an empty buffer when no samples are captured", async () => {
    const { FakeAudioContext } = setupFakeAudioContext();
    window.AudioContext = FakeAudioContext;
    const cap = await captureAudio({});
    cap.stop();
    expect((await cap.done).audioData.length).toBe(0);
  });
});
