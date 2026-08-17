/**
 * imageGen — hand Open Chat's agent off to Off Grid AI for on-device image
 * generation.
 *
 * Off Grid (ai.offgridmobile) runs Stable Diffusion fully on-device with models
 * already installed on the phone. Driving its React Native image-gen UI via the
 * accessibility bridge is unreliable, so this tool opens Off Grid (via the phone
 * control open_app tool) and the user generates the image there. The agent still
 * completes the request end-to-end from Open Chat's perspective.
 */

/** Tool schema the model sees for image generation. */
export const IMAGE_GEN_TOOL = {
  name: "image_gen",
  description:
    "Generate an image. Opens the Off Grid AI app (on-device Stable Diffusion) so the user can generate the image. Pass a detailed description of the image to prompt.",
  parameters: {
    prompt: { type: "string", description: "Detailed description of the image the user wants" },
  },
};

const OFF_GRID_PACKAGE = "ai.offgridmobile";

/**
 * Open Off Grid for image generation.
 * @param {object} opts
 * @param {string} opts.prompt - image description
 * @param {object} [opts.phoneControl] - preloaded PhoneControl plugin
 * @returns {Promise<{ok:boolean, opened?:boolean, error?:string}>}
 */
export async function generateImage({ prompt, phoneControl } = {}) {
  if (!prompt) return { ok: false, error: "image_gen requires a prompt" };
  const { loadPhoneControl } = await import("./modelRegistry.js");
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
      opened: res?.ok === true,
      note: "Opened Off Grid AI. The user can generate the image there (on-device Stable Diffusion).",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
