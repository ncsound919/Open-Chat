/**
 * Web fallback for MediaPipeGemma. On non-native platforms on-device Gemma
 * is not available — return safe defaults so web builds/tests still render.
 */

export async function getStatus() {
  return { available: false, modelLoaded: false, modelPath: "", loadedFileName: "" };
}

export async function listModels() {
  return { models: [] };
}

export async function downloadModel() {
  return { ok: false, error: "mediapipe not available on web" };
}

export async function loadModel() {
  return { ok: false, error: "mediapipe not available on web" };
}

export async function generate() {
  return { text: "", error: "mediapipe not available on web" };
}

export async function cancel() {
  return { ok: false };
}

export async function unloadModel() {
  return { ok: false };
}

export async function deleteModel() {
  return { ok: false, error: "mediapipe not available on web" };
}

const MediaPipeGemmaWeb = {
  getStatus,
  listModels,
  downloadModel,
  loadModel,
  generate,
  cancel,
  unloadModel,
  deleteModel,
};

export default MediaPipeGemmaWeb;
