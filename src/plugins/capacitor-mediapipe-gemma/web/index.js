import { registerPlugin } from "@capacitor/core";

/**
 * MediaPipeGemma — native on-device Gemma runtime (MediaPipe tasks-genai).
 *
 * Downloads .task model bundles, loads them into the GPU/NPU-accelerated
 * LLM session, and streams generations back to the WebView. Everything runs
 * on-device; the only network traffic is the model download itself.
 */
const MediaPipeGemma = registerPlugin("MediaPipeGemma", {
  web: () => import("./web.js"),
});

export default MediaPipeGemma;
export { MediaPipeGemma };
