/**
 * Voice helpers for Open-Chat.
 * Audio capture produces Float32 PCM; the transcribe endpoint expects raw
 * int16 PCM, mono, 16 kHz. `pcmToBytes` handles resample + downmix + encode.
 */

const AETHERDESK_BASE = "http://127.0.0.1:8000/api/v1";

function isFullUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLocalhostHost(value) {
  const host = String(value || "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Build the transcribe/synthesize endpoint URL for a backend. */
export function buildVoiceEndpoint(backend, host, port, kind, baseUrl) {
  const action = kind === "transcribe" ? "transcribe" : "synthesize";
  if (backend === "aetherdesk") {
    const base = String(baseUrl || AETHERDESK_BASE).replace(/\/$/, "");
    return `${base}/voice/${action}`;
  }
  // draymond backend
  const trimmed = String(host || "127.0.0.1").trim();
  if (isFullUrl(trimmed)) {
    return `${trimmed.replace(/\/$/, "")}/api/v1/voice/${action}`;
  }
  if (isLocalhostHost(trimmed)) {
    const hostForUrl = trimmed === "::1" ? "[::1]" : trimmed;
    return `http://${hostForUrl}:${port || 3000}/api/v1/voice/${action}`;
  }
  return `https://${trimmed}/api/v1/voice/${action}`;
}

/** Resample Float32 PCM from `fromRate` to `toRate` by simple decimation/interpolation. */
export function downsample(input, fromRate, toRate) {
  if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) return input;
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.ceil(input.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = Math.min(input.length - 1, Math.floor(i / ratio));
    out[i] = input[srcIndex];
  }
  return out;
}

/** Convert Float32 [-1,1] samples to int16 little-endian bytes. */
export function float32ToInt16(input) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Downmix to mono, resample to 16 kHz, encode as int16 PCM bytes. */
export function pcmToBytes(audioData, sampleRate) {
  if (!audioData || audioData.length === 0) {
    return new Uint8Array(0);
  }
  let mono = audioData;
  if (mono.length > 1 && audioData.numberOfChannels) {
    // Web Audio AudioBuffer-like input (has numberOfChannels)
    const ch0 = audioData.getChannelData(0);
    const ch1 = audioData.numberOfChannels > 1 ? audioData.getChannelData(1) : null;
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) {
      mono[i] = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
    }
  }
  const resampled = downsample(mono, sampleRate || 48000, 16000);
  return float32ToInt16(resampled);
}

/** Capture mic audio and resolve with a Float32Array of raw PCM + sample rate. */
export async function captureAudio(stream) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const sampleRate = ctx.sampleRate || 48000;
  const samples = [];
  const recorder = ctx.createScriptProcessor(4096, 1, 1);
  recorder.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    samples.push(new Float32Array(data));
  };
  // Create a silent destination so the processor fires without audible feedback.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(recorder);
  recorder.connect(silent);
  silent.connect(ctx.destination);

  let resolveFn;
  const done = new Promise((resolve) => {
    resolveFn = resolve;
  });
  const stop = () => {
    recorder.onaudioprocess = null;
    recorder.disconnect();
    source.disconnect();
    ctx.close();
    const total = samples.reduce((n, a) => n + a.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const a of samples) {
      merged.set(a, offset);
      offset += a.length;
    }
    resolveFn({ audioData: merged, sampleRate });
  };
  return { stop, done };
}

/** Transcribe Float32 PCM audio and return the transcript text. */
export async function transcribeAudio(audioData, sampleRate, backend, host, port, token, apiKey, baseUrl) {
  const bytes = pcmToBytes(audioData, sampleRate || 48000);
  const url = buildVoiceEndpoint(backend, host, port, "transcribe", baseUrl);
  const headers = { "Content-Type": "application/octet-stream" };
  if (backend === "draymond" && token) headers.Authorization = `Bearer ${token}`;
  if (backend === "aetherdesk" && apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, { method: "POST", headers, body: bytes });
  if (!res.ok) throw new Error(`Transcribe failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data && data.text) || "";
}

/** Synthesize text and return a playable HTMLAudioElement. */
export async function synthesizeAndPlay(text, backend, host, port, token, apiKey, baseUrl) {
  const url = buildVoiceEndpoint(backend, host, port, "synthesize", baseUrl);
  const headers = { "Content-Type": "application/json" };
  if (backend === "draymond" && token) headers.Authorization = `Bearer ${token}`;
  if (backend === "aetherdesk" && apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Synthesize failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.audio) throw new Error("Synthesize returned no audio");
  const bin = atob(data.audio);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: "audio/wav" });
  const urlObj = URL.createObjectURL(blob);
  const audio = new Audio(urlObj);
  try {
    await audio.play();
  } catch (err) {
    URL.revokeObjectURL(urlObj);
    throw err;
  }
  return audio;
}

/** Resolve a capture: stop it, then await its done promise (order matters). */
export async function resolveCapture(cap) {
  if (!cap) return null;
  cap.stop();
  return await cap.done;
}
