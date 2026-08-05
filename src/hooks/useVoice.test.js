import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoice } from "./useVoice.js";

vi.mock("../utils/voice.js", () => ({
  captureAudio: vi.fn(),
  transcribeAudio: vi.fn(),
  synthesizeAndPlay: vi.fn(),
  resolveCapture: vi.fn(),
  classifyMicError: vi.fn((err) => `classified:${err?.message || err?.name || "unknown"}`),
}));

import {
  captureAudio,
  transcribeAudio,
  synthesizeAndPlay,
  resolveCapture,
  classifyMicError,
} from "../utils/voice.js";

const makeBot = (overrides = {}) => ({
  id: "b1",
  host: "127.0.0.1",
  port: 3000,
  token: "sekrit",
  voiceBackend: "draymond",
  voiceEnabled: true,
  aetherdeskApiKey: "akey",
  aetherdeskBaseUrl: "https://voice.example.com",
  lastMessageText: "",
  lastMessageStreaming: false,
  ...overrides,
});

function fakeStream(track = { stop: vi.fn() }) {
  return { getTracks: () => [track] };
}

let getUserMedia;

beforeEach(() => {
  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  captureAudio.mockReturnValue({ done: {}, stop: vi.fn() });
  resolveCapture.mockResolvedValue({
    audioData: new Float32Array([1, 2]),
    sampleRate: 16000,
  });
  transcribeAudio.mockResolvedValue("hello");
  synthesizeAndPlay.mockResolvedValue({ pause: vi.fn(), src: "" });
});

afterEach(() => {
  delete window.navigator.mediaDevices;
  vi.clearAllMocks();
});

describe("useVoice", () => {
  it("starts with mic off and speech disabled", () => {
    const { result } = renderHook(() => useVoice(makeBot()));
    expect(result.current.micActive).toBe(false);
    expect(result.current.speakEnabled).toBe(false);
  });

  it("startListening activates the mic and captures audio", async () => {
    const stream = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useVoice(makeBot()));

    let started;
    await act(async () => {
      started = await result.current.startListening();
    });

    expect(started).toBe(true);
    expect(result.current.micActive).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(captureAudio).toHaveBeenCalledWith(stream);
  });

  it("startListening does nothing when voice is not enabled", async () => {
    const { result } = renderHook(() =>
      useVoice(makeBot({ voiceEnabled: false }))
    );

    let started;
    await act(async () => {
      started = await result.current.startListening();
    });

    expect(started).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.micActive).toBe(false);
  });

  it("startListening reports an error when the mic is unavailable", async () => {
    getUserMedia.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useVoice(makeBot()));

    let started;
    await act(async () => {
      started = await result.current.startListening();
    });

    expect(started).toBeNull();
    expect(result.current.micActive).toBe(false);
    expect(classifyMicError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.micError).toBe("classified:denied");
  });

  it("stopAndTranscribe returns the transcript and stops the mic", async () => {
    const track = { stop: vi.fn() };
    const stream = fakeStream(track);
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      await result.current.startListening();
    });

    let text;
    await act(async () => {
      text = await result.current.stopAndTranscribe();
    });

    expect(text).toBe("hello");
    expect(result.current.micActive).toBe(false);
    expect(track.stop).toHaveBeenCalled();
    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.any(Float32Array),
      16000,
      "draymond",
      "127.0.0.1",
      3000,
      "sekrit",
      "akey",
      "https://voice.example.com"
    );
  });

  it("stopAndTranscribe returns '' and surfaces a mic error on failure", async () => {
    transcribeAudio.mockRejectedValue(new Error("no speech detected"));
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      await result.current.startListening();
    });

    let text;
    await act(async () => {
      text = await result.current.stopAndTranscribe();
    });

    expect(text).toBe("");
    expect(result.current.micError).toBe("no speech detected");
  });

  it("stopAndTranscribe returns '' when nothing was recorded", async () => {
    const { result } = renderHook(() => useVoice(makeBot()));

    let text;
    await act(async () => {
      text = await result.current.stopAndTranscribe();
    });

    expect(text).toBe("");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("uses the aetherdesk backend when configured", async () => {
    const bot = makeBot({ voiceBackend: "aetherdesk" });
    const track = { stop: vi.fn() };
    getUserMedia.mockResolvedValue(fakeStream(track));
    const { result } = renderHook(() => useVoice(bot));

    await act(async () => {
      await result.current.startListening();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.any(Float32Array),
      16000,
      "aetherdesk",
      "127.0.0.1",
      3000,
      "sekrit",
      "akey",
      "https://voice.example.com"
    );
  });

  it("falls back to the default transcription error message", async () => {
    transcribeAudio.mockRejectedValue(new Error());
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      await result.current.startListening();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(result.current.micError).toBe("Transcription failed.");
  });

  it("cancelListening stops the capture without producing text", async () => {
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      await result.current.startListening();
    });

    let text;
    await act(async () => {
      text = await result.current.cancelListening();
    });

    expect(text).toBeUndefined();
    expect(result.current.micActive).toBe(false);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("speak synthesizes and stores the audio when speech is enabled", async () => {
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    await act(async () => {
      await result.current.speak("say this");
    });

    expect(synthesizeAndPlay).toHaveBeenCalledWith(
      "say this",
      "draymond",
      "127.0.0.1",
      3000,
      "sekrit",
      "akey",
      "https://voice.example.com"
    );
    expect(result.current.micError).toBeNull();
  });

  it("speak no-ops while speech is disabled", async () => {
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      await result.current.speak("nothing to say");
    });

    expect(synthesizeAndPlay).not.toHaveBeenCalled();
  });

  it("speak records an error when synthesis fails", async () => {
    synthesizeAndPlay.mockRejectedValue(new Error("synthesis down"));
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    await act(async () => {
      await result.current.speak("hello");
    });

    expect(result.current.micError).toBe("Voice playback failed: synthesis down");
  });

  it("handles a synthesis error without a message", async () => {
    synthesizeAndPlay.mockRejectedValue(new Error());
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    await act(async () => {
      await result.current.speak("hello");
    });

    expect(result.current.micError).toBe("Voice playback failed: ");
  });

  it("interrupts a previous blob playback before speaking again", async () => {
    const previousAudio = { pause: vi.fn(), src: "blob:open-chat/123" };
    synthesizeAndPlay
      .mockResolvedValueOnce(previousAudio)
      .mockResolvedValueOnce({ pause: vi.fn(), src: "" });
    const { result } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    await act(async () => {
      await result.current.speak("first");
    });
    await act(async () => {
      await result.current.speak("second, interrupts");
    });

    expect(previousAudio.pause).toHaveBeenCalled();
  });

  it("auto-speaks a new final bot message when enabled", async () => {
    const bot = makeBot({ lastMessageText: "hi from the agent" });
    const { result } = renderHook(() => useVoice(bot));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });

    expect(synthesizeAndPlay).toHaveBeenCalledWith(
      "hi from the agent",
      "draymond",
      "127.0.0.1",
      3000,
      "sekrit",
      "akey",
      "https://voice.example.com"
    );
  });

  it("does not auto-speak while a message is still streaming", async () => {
    const bot = makeBot({ lastMessageText: "partial...", lastMessageStreaming: true });
    const { result } = renderHook(() => useVoice(bot));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });

    expect(synthesizeAndPlay).not.toHaveBeenCalled();
  });

  it("does not auto-speak the same message twice", async () => {
    const bot = makeBot({ lastMessageText: "hi from the agent" });
    const { result } = renderHook(() => useVoice(bot));

    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    expect(synthesizeAndPlay).toHaveBeenCalledTimes(1);

    // Toggle speech off/on so the auto-speak effect re-runs with the same
    // text; the already-spoken guard must skip a second synthesis.
    await act(async () => {
      result.current.setSpeakEnabled(false);
    });
    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    expect(synthesizeAndPlay).toHaveBeenCalledTimes(1);
  });

  it("does not auto-speak when speech is disabled", async () => {
    const bot = makeBot({ lastMessageText: "ignored" });
    renderHook(() => useVoice(bot));
    await act(async () => {});
    expect(synthesizeAndPlay).not.toHaveBeenCalled();
  });

  it("stops microphone tracks and pauses playback on unmount", async () => {
    const track = { stop: vi.fn() };
    getUserMedia.mockResolvedValue(fakeStream(track));
    const audio = { pause: vi.fn(), src: "" };
    synthesizeAndPlay.mockResolvedValue(audio);
    const { result, unmount } = renderHook(() => useVoice(makeBot()));

    await act(async () => {
      await result.current.startListening();
    });
    await act(async () => {
      result.current.setSpeakEnabled(true);
    });
    await act(async () => {
      await result.current.speak("goodbye");
    });

    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(audio.pause).toHaveBeenCalled();
  });
});
