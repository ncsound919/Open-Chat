import { useCallback, useEffect, useRef, useState } from "react";
import { localChat } from "../utils/OnDeviceAI.js";

/**
 * Hands-free voice call — listen → local model → speak, in a loop.
 * Fully on-device when the local model is loaded (no server needed).
 *
 * STT: Web Speech API (SpeechRecognition) · Model: OnDeviceAI.localChat ·
 * TTS: speechSynthesis.
 */

function getRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return SR ? new SR() : null;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setTimeout(resolve, Math.min(30000, 5000 + text.length * 40));
  });
}

export function useVoiceCall({ systemPrompt } = {}) {
  const [calling, setCalling] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState(null);

  const activeRef = useRef(false);
  const loopRef = useRef(false);
  const mutedRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    loopRef.current = false;
    window.speechSynthesis?.cancel?.();
    setCalling(false);
    setListening(false);
    setSpeaking(false);
  }, []);

  const runOnce = useCallback(async () => {
    if (!activeRef.current) return;
    const rec = getRecognition();
    if (!rec) {
      setError("Speech recognition not supported on this device.");
      activeRef.current = false;
      setCalling(false);
      return;
    }
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    const transcript = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      rec.onresult = (e) => finish(e.results?.[0]?.[0]?.transcript ?? "");
      rec.onerror = () => finish("");
      rec.onend = () => finish("");
      rec.start();
      setTimeout(() => finish(""), 15000);
    });

    if (!activeRef.current) return;
    setListening(false);
    setLastTranscript(transcript);
    if (!transcript.trim()) {
      if (!mutedRef.current) await speak("I'm listening.");
      return;
    }

    setSpeaking(true);
    const reply = await localChat(transcript, { systemPrompt });
    setProvider(reply.provider || "none");
    setLastReply(reply.text);
    if (!mutedRef.current && reply.text) await speak(reply.text);
    setSpeaking(false);
  }, [systemPrompt]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    setCalling(true);
    setError(null);
    loopRef.current = true;
    (async () => {
      while (activeRef.current && loopRef.current) {
        setListening(true);
        await runOnce();
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
  }, [runOnce]);

  useEffect(() => () => stop(), [stop]);

  return {
    calling, listening, speaking, lastTranscript, lastReply, provider, error,
    start, stop, mute: () => { mutedRef.current = true; window.speechSynthesis?.cancel?.(); },
    unmute: () => { mutedRef.current = false; },
  };
}
