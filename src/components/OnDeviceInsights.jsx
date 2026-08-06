import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { generateStream, isAvailable, buildInsightPrompt } from "../utils/OnDeviceAI.js";

/**
 * OnDeviceInsights
 *
 * Renders a collapsible "On-device insights" panel beneath a Draymond bot
 * message. When expanded for the first time, Gemini Nano (Chrome Prompt API)
 * generates 2–4 complementary tips/details that enrich the Draymond response.
 *
 * Props:
 *   botMessage   — the full text the Draymond bot sent
 *   userMessage  — the original user message that triggered it
 *   accentColor  — the bot's accent color (used for theming the panel)
 */
export function OnDeviceInsights({
  botMessage,
  userMessage = "",
  accentColor = "#818cf8",
  width = "100%",
}) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(null); // null = checking, true/false
  const [status, setStatus] = useState("idle"); // idle | loading | streaming | done | error
  const [text, setText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const abortRef = useRef(null);
  const isGeneratingRef = useRef(false);
  const doneRef = useRef(false);

  const accent = accentColor || "#818cf8";

  // Check API availability once on mount
  useEffect(() => {
    let mounted = true;
    isAvailable().then((nextAvailable) => {
      if (mounted) setAvailable(nextAvailable);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // When opened, kick off generation if we do not already have a successful result.
  // NOTE: `status` is intentionally NOT in the dependency list — putting it there
  // would abort the in-flight stream every time setStatus() runs. Retries are
  // triggered via retryNonce instead.
  useEffect(() => {
    if (!open || !available || isGeneratingRef.current || doneRef.current) {
      return undefined;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    isGeneratingRef.current = true;

    setStatus("loading");
    setText("");
    setErrorMsg("");

    const prompt = buildInsightPrompt(botMessage, userMessage);

    generateStream(
      prompt,
      (chunk) => {
        setText((prev) => prev + chunk);
        setStatus("streaming");
      },
      { signal: controller.signal }
    )
      .then(() => {
        doneRef.current = true;
        setStatus("done");
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setStatus("error");
        setErrorMsg(err.message || "On-device generation failed.");
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        isGeneratingRef.current = false;
      });

    return () => {
      controller.abort();
    };
  }, [open, available, botMessage, userMessage, retryNonce]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Don't render at all if we've confirmed it's unavailable
  if (available === false) return null;

  const isLoading = status === "loading";
  const isStreaming = status === "streaming";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <div
      style={{
        marginTop: 6,
        maxWidth: width,
        width: "100%",
        borderRadius: 10,
        overflow: "hidden",
        border: `1px solid ${accent}30`,
        background: "#13131e",
      }}
    >
      {/* Toggle row */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: accent,
          fontSize: 11,
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        {/* Chevron */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            flexShrink: 0,
          }}
        >
          <polyline
            points="2,2 7,5 2,8"
            fill="none"
            stroke={accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Device icon */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={accent}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>

        <span style={{ fontWeight: 500 }}>
          On-device insights
          {available === null && " …"}
          {(isLoading || isStreaming) && (
            <span style={{ opacity: 0.6, fontWeight: 400 }}> · generating…</span>
          )}
          {isDone && text && (
            <span style={{ opacity: 0.5, fontWeight: 400 }}> · Gemini Nano</span>
          )}
        </span>
      </button>

      {/* Content panel */}
      {open && (
        <div
          style={{
            padding: "0 12px 10px 12px",
            borderTop: `1px solid ${accent}20`,
          }}
        >
          {/* Loading spinner */}
          {isLoading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 10,
                color: "#555568",
                fontSize: 12,
              }}
            >
              <LoadingDots color={accent} />
              <span>Thinking on-device…</span>
            </div>
          )}

          {/* Streaming / done text */}
          {(isStreaming || isDone) && text && (
            <div
              style={{
                paddingTop: 10,
                fontSize: 12,
                color: "#c8c8d8",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {text}
              {isStreaming && <BlinkCursor color={accent} />}
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div
              style={{
                paddingTop: 10,
                fontSize: 11,
                color: "#ef4444",
              }}
            >
              {errorMsg}
              <button
                onClick={() => {
                  doneRef.current = false;
                  setStatus("idle");
                  setRetryNonce((n) => n + 1);
                }}
                style={{
                  marginLeft: 8,
                  background: "none",
                  border: "none",
                  color: accent,
                  cursor: "pointer",
                  fontSize: 11,
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Unavailable hint (shown when available === null and user opened panel) */}
          {available === null && !isLoading && !text && !isError && (
            <div
              style={{
                paddingTop: 10,
                fontSize: 11,
                color: "#555568",
              }}
            >
              Checking for on-device AI…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Three animated dots for the loading state */
function LoadingDots({ color }) {
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 3,
        alignItems: "center",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: color,
            display: "inline-block",
            animation: `ondevice-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes ondevice-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </span>
  );
}

/** Blinking cursor shown while streaming */
function BlinkCursor({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 2,
        height: "1em",
        background: color,
        marginLeft: 2,
        verticalAlign: "text-bottom",
        animation: "ondevice-blink 1s step-end infinite",
        opacity: 0.8,
      }}
    >
      <style>{`
        @keyframes ondevice-blink {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 0; }
        }
      `}</style>
    </span>
  );
}

OnDeviceInsights.propTypes = {
  botMessage: PropTypes.string.isRequired,
  userMessage: PropTypes.string,
  accentColor: PropTypes.string,
  width: PropTypes.string,
};

LoadingDots.propTypes = { color: PropTypes.string.isRequired };
BlinkCursor.propTypes = { color: PropTypes.string.isRequired };
