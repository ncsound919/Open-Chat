import { useCallback, useEffect, useRef, useState } from "react";
import { captureAudio, transcribeAudio, synthesizeAndPlay } from "../utils/voice.js";

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

  const backend = bot?.voiceBackend === "aetherdesk" ? "aetherdesk" : "draymond";
  const enabled = bot?.voiceEnabled === true;

  const stopCapture = useCallback(async () => {
    const cap = captureRef.current;
    if (!cap) return null;
    captureRef.current = null;
    const { audioData, sampleRate } = await cap.done;
    cap.stop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setMicActive(false);
    return { audioData, sampleRate };
  }, []);

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
      setMicError("Microphone permission denied or unavailable.");
      setMicActive(false);
      return null;
    }
  }, [enabled]);

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
        bot?.port,
        bot?.token,
        bot?.aetherdeskApiKey
      );
    } catch (err) {
      setMicError(err.message || "Transcription failed.");
      return "";
    }
  }, [stopCapture, backend, bot]);

  const speak = useCallback(
    async (text) => {
      if (!speakEnabled || !enabled || !text) return;
      try {
        if (speakRef.current) {
          speakRef.current.pause();
        }
        const audio = await synthesizeAndPlay(
          text,
          backend,
          bot?.host,
          bot?.port,
          bot?.token,
          bot?.aetherdeskApiKey
        );
        speakRef.current = audio;
      } catch (err) {
        setMicError("Voice playback failed: " + (err.message || ""));
      }
    },
    [speakEnabled, enabled, backend, bot]
  );

  // Auto-speak new bot messages when enabled.
  useEffect(() => {
    if (!speakEnabled || !enabled) return;
    const last = bot?.lastMessageText;
    if (last && last.trim()) {
      speak(last).catch(() => {});
    }
  }, [bot?.lastMessageText, speakEnabled, enabled, speak, bot]);

  // Cleanup on unmount / bot change.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (speakRef.current) {
        speakRef.current.pause();
      }
    };
  }, []);

  return {
    micActive,
    speakEnabled,
    micError,
    setSpeakEnabled,
    startListening,
    stopAndTranscribe,
    speak,
  };
}
