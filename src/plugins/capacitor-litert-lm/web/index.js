import { registerPlugin } from "@capacitor/core";

/**
 * LitertLm — native on-device LLM runtime (Google LiteRT-LM).
 *
 * Downloads `.litertlm` model bundles, loads them into the CPU/GPU-accelerated
 * LiteRT-LM engine, and streams generations back to the WebView. Everything
 * runs on-device; the only network traffic is the model download itself.
 */
const LitertLm = registerPlugin("LitertLm", {
  web: () => import("./web.js"),
});

export default LitertLm;
export { LitertLm };