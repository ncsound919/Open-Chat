/**
 * Web fallback for LitertLm. On non-native platforms on-device LiteRT-LM is
 * not available — return safe defaults so web builds/tests still render.
 */

export async function getStatus() {
  return { available: false, modelLoaded: false, modelPath: "", loadedFileName: "" };
}

export async function listModels() {
  return { models: [] };
}

export async function downloadModel() {
  return { ok: false, error: "litert-lm not available on web" };
}

export async function loadModel() {
  return { ok: false, error: "litert-lm not available on web" };
}

export async function generate() {
  return { text: "", error: "litert-lm not available on web" };
}

export async function generateSession() {
  return { text: "", error: "litert-lm not available on web" };
}

export async function beginSession() {
  return { ok: false, error: "litert-lm not available on web" };
}

export async function resetSession() {
  return { ok: false };
}

export async function cancel() {
  return { ok: false };
}

export async function unloadModel() {
  return { ok: false };
}

export async function deleteModel() {
  return { ok: false, error: "litert-lm not available on web" };
}

const LitertLmWeb = {
  getStatus,
  listModels,
  downloadModel,
  loadModel,
  generate,
  generateSession,
  beginSession,
  resetSession,
  cancel,
  unloadModel,
  deleteModel,
};

export default LitertLmWeb;