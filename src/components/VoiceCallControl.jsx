import PropTypes from "prop-types";
import { useVoiceCall } from "../hooks/useVoiceCall.js";

/** The actual voice-call control — mounted only after the on-device model is ready. */
export function VoiceCallControl({ botConfig }) {
  const call = useVoiceCall({
    systemPrompt: `You are ${botConfig?.name ?? "Open Chat"}, a helpful assistant. Keep replies brief and conversational for voice.`,
  });
  const { calling, listening, speaking, lastReply, provider, error, start, stop } = call;
  const botName = botConfig?.name ?? "Open Chat";
  const status = error ? `error: ${error}` : lastReply ? `last: ${lastReply.slice(0, 60)}` : "";

  return (
    <button
      type="button"
      onClick={calling ? stop : start}
      aria-label={calling ? "End voice call" : `Start voice call with ${botName}`}
      title={calling ? `End voice call ${status ? `— ${status}` : ""}` : `Start voice call with ${botName} (on-device ${provider || "model"})`}
      style={{
        background: "none", border: "none", cursor: "pointer",
        width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
        color: calling ? "#f97316" : "#9ca3af",
      }}
    >
      {calling ? (
        <span style={{ fontSize: 16 }}>{listening ? "🎙" : speaking ? "🔊" : "📞"}</span>
      ) : (
        <span style={{ fontSize: 16 }}>📞</span>
      )}
    </button>
  );
}

VoiceCallControl.propTypes = {
  botConfig: PropTypes.shape({ name: PropTypes.string }),
};
