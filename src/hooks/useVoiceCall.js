import { useCallback, useEffect, useRef, useState } from "react";
import { localChatWithTools, isAvailable, webllmAvailable, ggufAvailable } from "../utils/OnDeviceAI.js";
import { skillList, runSkill } from "../utils/skillRegistry.js";

/**
 * Hands-free voice call — listen → local model → speak, in a loop.
 * The on-device model can call phone skills (open apps, read notifications)
 * and read the Draymond phase recap aloud.
 *
 * STT: Web Speech API · Model: OnDeviceAI (Nano/WebLLM/GGUF) · TTS: speechSynthesis.
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

export function useVoiceCall({ systemPrompt, draymondUrl, chatSend } = {}) {
  const [calling, setCalling] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState(null);
  const [recapText, setRecapText] = useState("");
  const [modelKind, setModelKind] = useState("");

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

  // Detect which on-device model is usable (Nano / WebLLM / GGUF).
  useEffect(() => {
    let mounted = true;
    Promise.all([isAvailable(), webllmAvailable(), ggufAvailable()])
      .then(([nano, wl, gg]) => {
        if (mounted) setModelKind(nano ? "nano" : wl ? "webllm" : gg ? "gguf" : "none");
      })
      .catch(() => { if (mounted) setModelKind("none"); });
    return () => { mounted = false; };
  }, []);

  const speakRecap = useCallback(async (phase = "evening") => {
    if (!draymondUrl) {
      const msg = "Draymond not configured; no recap available.";
      setRecapText(msg);
      if (!mutedRef.current) await speak(msg);
      return { ok: false, detail: msg };
    }
    try {
      const res = await fetch(`${draymondUrl}/api/ops/communicator?phase=${phase}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`recap HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.recap?.summary || data?.markdown?.slice(0, 500) || "No recap available.";
      setRecapText(text);
      if (!mutedRef.current) await speak(text);
      return { ok: true, text };
    } catch (err) {
      const msg = `Recap unavailable: ${err.message}`;
      setRecapText(msg);
      setError(msg);
      return { ok: false, detail: msg };
    }
  }, [draymondUrl, mutedRef]);

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
    // On-device chat WITH phone skills (read recap, open apps, reminders, send).
    const reply = await localChatWithTools(transcript, {
      systemPrompt,
      tools: skillList(),
      toolHandler: (name, args) => runSkill(name, args, {
        draymondUrl,
        onSend: chatSend,
        onSpeak: async (text) => { if (!mutedRef.current) await speak(text); },
      }),
      forceGguf: modelKind === "gguf",
    });
    setProvider(reply.provider || "none");
    const toolNote = reply.toolCalls?.length ? ` (${reply.toolCalls.map((t) => t.name).join(", ")})` : "";
    setLastReply((reply.text || "") + toolNote);
    if (!mutedRef.current && reply.text) await speak(reply.text);
    setSpeaking(false);
  }, [systemPrompt, modelKind, chatSend, draymondUrl]);

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
    recapText, modelKind, speakRecap,
    start, stop, mute: () => { mutedRef.current = true; window.speechSynthesis?.cancel?.(); },
    unmute: () => { mutedRef.current = false; },
  };
}
