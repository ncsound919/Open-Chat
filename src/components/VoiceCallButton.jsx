import { useState, useEffect, Suspense, lazy } from "react";
import PropTypes from "prop-types";

// Lazily loaded so Chat.jsx's module graph never pulls in the voice/model code.
// Only mounts once an on-device model is available.
const VoiceCallControl = lazy(() =>
  import("./VoiceCallControl.jsx").then((m) => ({ default: m.VoiceCallControl })),
);

export function VoiceCallButton({ botConfig }) {
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      import("../utils/OnDeviceAI.js").then((m) => m.webllmAvailable()),
      import("../utils/OnDeviceAI.js").then((m) => m.isAvailable()),
    ])
      .then(([w, n]) => { if (mounted) setModelReady(w || n); })
      .catch(() => { if (mounted) setModelReady(false); });
    return () => { mounted = false; };
  }, []);

  if (!modelReady) return null;

  return (
    <Suspense fallback={null}>
      <VoiceCallControl botConfig={botConfig} />
    </Suspense>
  );
}

VoiceCallButton.propTypes = {
  botConfig: PropTypes.shape({ name: PropTypes.string }),
};
