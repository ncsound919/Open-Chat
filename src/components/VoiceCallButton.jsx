import { useState, useEffect, Suspense, lazy } from "react";
import PropTypes from "prop-types";

// Lazily loaded so Chat.jsx's module graph never pulls in the voice/model code.
// Only mounts once an on-device model is available.
const VoiceCallControl = lazy(() =>
  import("./VoiceCallControl.jsx").then((m) => ({ default: m.VoiceCallControl })),
);

export function VoiceCallButton({ botConfig, draymondUrl, apiKey, chatSend }) {
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Show the call/recap buttons when an on-device model is ready OR a
    // remote chat endpoint (Draymond) is reachable — so voice calling and
    // the recap flow work on the phone today.
    const checks = [
      import("../utils/OnDeviceAI.js").then((m) => m.isAvailable()),
      import("../utils/OnDeviceAI.js").then((m) => m.webllmAvailable()),
      import("../utils/OnDeviceAI.js").then((m) => m.ggufAvailable()),
    ];
    Promise.all(checks)
      .then(([nano, wl, gg]) => { if (mounted) setModelReady(nano || wl || gg); })
      .catch(() => { if (mounted) setModelReady(false); });
    return () => { mounted = false; };
  }, []);

  if (!modelReady && !draymondUrl) return null;

  return (
    <Suspense fallback={null}>
      <VoiceCallControl botConfig={botConfig} draymondUrl={draymondUrl} apiKey={apiKey} chatSend={chatSend} />
    </Suspense>
  );
}

VoiceCallButton.propTypes = {
  botConfig: PropTypes.shape({ name: PropTypes.string, voiceCallEnabled: PropTypes.bool }),
  draymondUrl: PropTypes.string,
  apiKey: PropTypes.string,
  chatSend: PropTypes.func,
};
