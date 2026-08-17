export async function getStatus() {
  return { available: false, modelLoaded: false };
}
export async function listModels() {
  return { models: [] };
}
export async function downloadModel() {
  throw new Error("OnnxImageGen not available on this platform");
}
export async function loadModel() {
  throw new Error("OnnxImageGen not available on this platform");
}
export async function generate() {
  throw new Error("OnnxImageGen not available on this platform");
}
export async function unloadModel() {
  return { ok: true };
}
export async function deleteModel() {
  return { ok: true };
}

export const OnnxImageGen = {
  getStatus,
  listModels,
  downloadModel,
  loadModel,
  generate,
  unloadModel,
  deleteModel,
};
