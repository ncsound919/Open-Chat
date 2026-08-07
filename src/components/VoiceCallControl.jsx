import PropTypes from "prop-types";
import { useVoiceCall } from "../hooks/useVoiceCall.js";

/** The actual voice-call control — mounted only after an on-device model is ready. */
export function VoiceCallControl({ botConfig, draymondUrl, chatSend }) {
  const call = useVoiceCall({
    systemPrompt: `You are ${botConfig?.name ?? "Open Chat"}, a helpful assistant. You can complete tasks on this phone by calling skills. Keep replies brief and conversational for voice.`,
    draymondUrl,
    chatSend,
  });
  const {
    calling, listening, speaking, lastReply, error, recapText, modelKind,
    speakRecap, start, stop,
  } = call;
  const botName = botConfig?.name ?? "Open Chat";
  const status = error ? `error: ${error}` : lastReply ? `last: ${lastReply.slice(0, 60)}` : "";
  const model = modelKind === "none" ? "model loading" : `model: ${modelKind}`;

  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button
        type="button"
        onClick={calling ? stop : start}
        aria-label={calling ? "End voice call" : `Start voice call with ${botName}`}
        title={calling ? `End voice call ${status ? `— ${status}` : ""}` : `Start voice call with ${botName} (${model})`}
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
      <button
        type="button"
        onClick={() => speakRecap("evening")}
        aria-label="Read the Draymond evening recap"
        title={recapText ? `Recap: ${recapText.slice(0, 80)}` : "Read the Draymond evening recap"}
        style={{
          background: "none", border: "none", cursor: "pointer",
          width: 32, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
          color: recapText ? "#22d3ee" : "#9ca3af",
        }}
      >
        <span style={{ fontSize: 15 }}>📰</span>
      </button>
    </div>
  );
}

VoiceCallControl.propTypes = {
  botConfig: PropTypes.shape({ name: PropTypes.string, voiceCallEnabled: PropTypes.bool }),
  draymondUrl: PropTypes.string,
  chatSend: PropTypes.func,
};
