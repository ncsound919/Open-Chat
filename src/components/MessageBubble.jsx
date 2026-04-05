import React, { useState, memo } from "react";
import PropTypes from "prop-types";
import { SimpleMarkdown } from "../utils/markdown.jsx";
import {
  CopyIcon,
  TrashIcon,
  DoubleCheck,
  TypingDots,
} from "./icons/Icons.jsx";

/**
 * MessageBubble component with context menu
 * Memoized to prevent unnecessary re-renders
 */
export const MessageBubble = memo(function MessageBubble({
  msg,
  bot,
  onDelete,
}) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";

  const copy = () => {
    navigator.clipboard?.writeText(msg.text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setMenu(false);
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 4,
        position: "relative",
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          background: msg.error ? "#2a1a1a" : isUser ? bot.color : "#1c1c28",
          color: msg.error ? "#ef4444" : isUser ? "#0d0d14" : "#e8e8f0",
          border: msg.error ? "1px solid #ef444440" : "none",
          borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          padding: "10px 14px",
          lineHeight: 1.5,
          wordBreak: "break-word",
          userSelect: "text",
        }}
      >
        {/* User messages are plain text; bot messages get markdown */}
        {isUser ? (
          <span style={{ fontSize: 15, whiteSpace: "pre-wrap" }}>
            {msg.text || (msg.streaming ? "" : "…")}
          </span>
        ) : (
          <SimpleMarkdown text={msg.text || (msg.streaming ? "" : "…")} />
        )}

        {msg.streaming && <TypingDots color={isUser ? "#0d0d14" : bot.color} />}

        {isUser && !msg.streaming && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              marginLeft: 6,
              verticalAlign: "middle",
              opacity: 0.65,
            }}
          >
            {msg.read ? (
              <DoubleCheck color="#0d0d14" />
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0d0d14"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        )}
      </div>

      {/* Right-click context menu */}
      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setMenu(false)}
          />
          <div
            style={{
              position: "absolute",
              [isUser ? "right" : "left"]: 0,
              bottom: "calc(100% + 4px)",
              background: "#1c1c2e",
              borderRadius: 10,
              padding: 4,
              zIndex: 50,
              boxShadow: "0 4px 20px #00000060",
              border: "1px solid #2a2a3e",
              minWidth: 140,
            }}
          >
            {[
              {
                icon: <CopyIcon />,
                label: copied ? "Copied!" : "Copy text",
                fn: copy,
              },
              {
                icon: <TrashIcon />,
                label: "Delete",
                fn: () => {
                  onDelete();
                  setMenu(false);
                },
                danger: true,
              },
            ].map((item) => (
              <button
                key={item.label}
                onClick={item.fn}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "9px 12px",
                  background: "none",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  color: item.danger ? "#ef4444" : "#e0e0f0",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#ffffff10")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "none")
                }
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

MessageBubble.propTypes = {
  msg: PropTypes.shape({
    role: PropTypes.oneOf(["user", "assistant"]).isRequired,
    text: PropTypes.string,
    error: PropTypes.bool,
    streaming: PropTypes.bool,
    read: PropTypes.bool,
  }).isRequired,
  bot: PropTypes.shape({
    color: PropTypes.string.isRequired,
  }).isRequired,
  onDelete: PropTypes.func.isRequired,
};
