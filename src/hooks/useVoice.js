import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureAudio,
  transcribeAudio,
  transcribeNativeSTT,
  synthesizeAndPlay,
  resolveCapture,
  classifyMicError,
} from "../utils/voice.js";
import { loadPhoneControl } from "../utils/modelRegistry.js";
import { isNative } from "../utils/platform.js";

/**
 * Push-to-talk + auto-speak voice for a chat bot.
 *
 * @param {object} bot  The active bot config (host, port, token, voiceBackend,
 *                      voiceEnabled, aetherdeskApiKey, lastMessageText).
 */
export function useVoice(bot) {
  const [micActive, setMicActive] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [micError, setMicError] = useState(null);
  const streamRef = useRef(null);
  const captureRef = useRef(null);
  const speakRef = useRef(null);
  const lastSpokenRef = useRef("");

  const backend = bot?.voiceBackend === "aetherdesk" ? "aetherdesk" : "draymond";
  const enabled = bot?.voiceEnabled === true;

  const stopCapture = useCallback(async () => {
    const cap = captureRef.current;
    if (!cap) return null;
    captureRef.current = null;
    const capture = await resolveCapture(cap);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setMicActive(false);
    return capture;
  }, []);

  /**
   * Start Android native speech recognition (SpeechRecognizer Intent).
   * On native: launches the system prompt and returns true immediately — the
   * caller should call stopAndTranscribeNative() after the user stops speaking.
   * On web: returns false (no-op).
   */
  const startListeningNative = useCallback(async () => {
    if (!enabled || !isNative()) return false;
    setMicError(null);
    setMicActive(true);
    return true;
  }, [enabled]);

  const startListening = useCallback(async () => {
    if (!enabled) return null;
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const cap = captureAudio(stream);
      captureRef.current = cap;
      setMicActive(true);
      return true;
    } catch (err) {
      setMicError(classifyMicError(err));
      setMicActive(false);
      return null;
    }
  }, [enabled]);

  /** Stop native STT and return the transcribed text. Throws on failure. */
  const stopAndTranscribeNative = useCallback(async ({ language, prompt } = {}) => {
    setMicActive(false);
    try {
      return await transcribeNativeSTT({ language, prompt });
    } catch (err) {
      setMicError(err.message || "Transcription failed.");
      return "";
    }
  }, []);

  /** Stop listening, transcribe, and return the text (caller puts it in input). */

  /** Stop listening, transcribe, and return the text (caller puts it in input). */
  const stopAndTranscribe = useCallback(async () => {
    const cap = await stopCapture();
    if (!cap) return "";
    try {
      return await transcribeAudio(
        cap.audioData,
        cap.sampleRate,
        backend,
        bot?.host,
        bot?.token,
        bot?.aetherdeskApiKey,
        bot?.aetherdeskBaseUrl
      );
    } catch (err) {
      setMicError(err.message || "Transcription failed.");
      return "";
    }
  }, [stopCapture, backend, bot]);

  /** Stop listening without transcribing (cancel). */
  const cancelListening = useCallback(async () => {
    await stopCapture();
  }, [stopCapture]);

  const speak = useCallback(
    async (text) => {
      if (!speakEnabled || !text) return;
      try {
        if (speakRef.current) {
          speakRef.current.pause();
          const oldSrc = speakRef.current.src;
          if (oldSrc && oldSrc.startsWith("blob:")) {
            URL.revokeObjectURL(oldSrc);
          }
        }
        // Prefer the native Android TTS engine (the phone assistant's voice).
        // window.speechSynthesis is a no-op in the Android WebView, so this
        // is what makes the local model audible on-device.
        let spokeNatively = false;
        try {
          const pc = await loadPhoneControl();
          if (pc?.speak && pc?.getStatus) {
            const r = await pc.speak({ text });
            spokeNatively = r?.ok === true;
          } else if (pc?.speak) {
            // Web fallback implements speak() without getStatus.
            const r = await pc.speak({ text });
            spokeNatively = r?.ok === true;
          }
        } catch {
          /* native bridge unavailable — fall through */
        }
        if (spokeNatively) {
          speakRef.current = { pause: () => {}, src: "" };
          return;
        }
        let audio;
        try {
          audio = await synthesizeAndPlay(
            text,
            bot?.voiceBackend,
            bot?.host,
            bot?.token,
            bot?.aetherdeskApiKey,
            bot?.aetherdeskBaseUrl
          );
        } catch (err) {
          if (typeof window !== "undefined" && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
            audio = { pause: () => window.speechSynthesis.cancel(), src: "" };
          } else {
            throw err;
          }
        }
        speakRef.current = audio;
      } catch (err) {
        setMicError("Voice playback failed: " + (err.message || ""));
      }
    },
    [speakEnabled, bot]
  );

  // Auto-speak a NEW final bot message when enabled. bot.lastMessageText is
  // always the newest message, so enabling speech speaks the current one;
  // lastSpokenRef guards against re-speaking the same message when the effect
  // re-runs (e.g. speech toggled off/on).
  useEffect(() => {
    if (!speakEnabled) return;
    const last = bot?.lastMessageText;
    if (!last || !last.trim()) return;
    const lastStreaming = bot?.lastMessageStreaming === true;
    if (lastStreaming) return; // wait for the stream to finish
    if (last === lastSpokenRef.current) return; // already spoken
    lastSpokenRef.current = last;
    speak(last).catch(() => {});
  }, [bot?.lastMessageText, bot?.lastMessageStreaming, speakEnabled, speak, bot]);

  // Cleanup on unmount / bot change.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (speakRef.current) {
        speakRef.current.pause();
        const src = speakRef.current.src;
        if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
      }
    };
  }, []);

  return {
    micActive,
    speakEnabled,
    micError,
    setSpeakEnabled,
    startListening,
    startListeningNative,
    stopAndTranscribe,
    stopAndTranscribeNative,
    cancelListening,
    speak,
  };
}
