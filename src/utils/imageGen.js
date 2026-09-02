/**
 * imageGen — on-device image generation for the local agent.
 *
 * Primary path: native Stable Diffusion via ONNX Runtime (OnnxImageGen
 * plugin) — downloads a model, runs the SD 1.5 pipeline, and returns the
 * image as a data URI for the chat UI.
 *
 * Fallback: if no native model is available, open the Off Grid AI app so the
 * user can generate there.
 */

import { loadOnnxImageGen, loadPhoneControl } from "./modelRegistry.js";

/** Tool schema the model sees for image generation. */
export const IMAGE_GEN_TOOL = {
  name: "image_gen",
  description:
    "Generate an image from a text description, entirely on-device. Provide a detailed description of the image you want.",
  parameters: {
    prompt: { type: "string", description: "Detailed description of the image to generate" },
  },
};

const OFF_GRID_PACKAGE = "ai.offgridmobile";

/** ONNX SD 1.5 model (modularai/stable-diffusion-1.5-onnx — fp32, standard NCHW, CPU/NNAPI compatible). */
const SD_MODEL_NAME = "sd-1.5-onnx";
const SD_MODEL_BASE =
  "https://huggingface.co/modularai/stable-diffusion-1.5-onnx/resolve/main/";
const SD_MODEL_FILES = [
  { path: "text_encoder/config.json", url: SD_MODEL_BASE + "text_encoder/config.json" },
  { path: "text_encoder/model.onnx", url: SD_MODEL_BASE + "text_encoder/model.onnx" },
  { path: "tokenizer/vocab.json", url: SD_MODEL_BASE + "tokenizer/vocab.json" },
  { path: "tokenizer/merges.txt", url: SD_MODEL_BASE + "tokenizer/merges.txt" },
  { path: "unet/model.onnx", url: SD_MODEL_BASE + "unet/model.onnx" },
  { path: "unet/model.onnx_data", url: SD_MODEL_BASE + "unet/model.onnx_data" },
  { path: "vae_decoder/config.json", url: SD_MODEL_BASE + "vae_decoder/config.json" },
  { path: "vae_decoder/model.onnx", url: SD_MODEL_BASE + "vae_decoder/model.onnx" },
];

/**
 * Generate an image on-device (native ONNX SD), or fall back to opening
 * Off Grid if no native model is present.
 * @param {object} opts
 * @param {string} opts.prompt - image description
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @returns {Promise<{ok:boolean, dataUri?:string, error?:string, openedOffGrid?:boolean}>}
 */
export async function generateImage({ prompt, phoneControl } = {}) {
  if (!prompt) return { ok: false, error: "image_gen requires a prompt" };

  // Primary: native ONNX Runtime SD.
  const native = await nativeGenerate(prompt);
  if (native?.ok) return native;
  // Fall through to Off Grid if the native path is unavailable or has no model.
  if (native?.error && native.error !== "no-model" && native.error !== "native-unavailable") {
    return { ok: false, error: native.error };
  }

  // Fallback: open Off Grid.
  return openOffGrid({ phoneControl });
}

/** Try native ONNX Runtime generation. */
async function nativeGenerate(prompt) {
  const ig = await loadOnnxImageGen();
  if (!ig?.generate) return { ok: false, error: "native-unavailable" };
  try {
    let status = await ig.getStatus().catch(() => ({ modelLoaded: false }));
    if (!status?.modelLoaded) {
      const { models = [] } = await ig.listModels().catch(() => ({ models: [] }));
      const existing = models.find((m) => m.name === SD_MODEL_NAME) || models[0];
      if (!existing) {
        // No model downloaded yet — download the SD 1.5 ONNX bundle (~3.9GB).
        if (typeof ig.downloadModel !== "function") return { ok: false, error: "no-model" };
        const dl = await ig
          .downloadModel({ name: SD_MODEL_NAME, files: SD_MODEL_FILES })
          .catch(() => ({ ok: false, error: "model download failed" }));
        if (dl?.ok !== true) return { ok: false, error: dl?.error || "Could not download the image model." };
        await ig.loadModel({ name: SD_MODEL_NAME }).catch(() => ({}));
      } else {
        await ig.loadModel({ name: existing.name }).catch(() => ({}));
      }
      status = await ig.getStatus().catch(() => ({ modelLoaded: false }));
      if (!status?.modelLoaded) return { ok: false, error: "Could not load the image model." };
    }
    const result = await ig.generate({ prompt });
    if (result?.ok !== true) return { ok: false, error: result?.error || "Image generation failed" };
    const data = result?.data || "";
    if (!data) return { ok: false, error: "Image generation returned no data" };
    const dataUri = /^data:/.test(data) ? data : `data:image/png;base64,${data}`;
    return { ok: true, dataUri, native: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Open Off Grid AI as a fallback so the user can still generate. */
async function openOffGrid({ phoneControl }) {
  const phone = phoneControl ?? (await loadPhoneControl());
  if (!phone?.openApp) {
    return { ok: false, error: "Phone control unavailable — can't open Off Grid." };
  }
  const status = await phone.getStatus().catch(() => ({ enabled: false }));
  if (!status?.enabled) {
    return {
      ok: false,
      error:
        "Accessibility service is not enabled. Ask the user to enable 'Open Chat' in System Settings > Accessibility, then try again.",
      needs_enablement: true,
    };
  }
  try {
    const res = await phone.openApp({ packageName: OFF_GRID_PACKAGE });
    return {
      ok: res?.ok === true,
      openedOffGrid: res?.ok === true,
      note: "Opened Off Grid AI so you can generate the image there.",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
