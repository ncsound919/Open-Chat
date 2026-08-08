import { registerPlugin } from "@capacitor/core";

/**
 * PhoneControl — native Android accessibility bridge.
 *
 * Lets an on-device agent (Gemma via MediaPipe) see the current screen and
 * drive the phone: tap, type, open apps, go back, swipe, and read the
 * accessibility tree. Requires the user to enable the Open-Chat accessibility
 * service once in system Settings (see openAccessibilitySettings()).
 */
const PhoneControl = registerPlugin("PhoneControl", {
  web: () => import("./web.js"),
});

export default PhoneControl;
export { PhoneControl };
