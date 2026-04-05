import React, { useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble.jsx";
import {
  BackIcon,
  SettingsIcon,
  SendIcon,
  KebabMenuIcon,
} from "./icons/Icons.jsx";
import { useAutoResize } from "../hooks/useAutoResize.js";
import { useScrollFollow } from "../hooks/useScrollFollow.js";
import { STATUS_LABEL, STATUS_COLOR } from "../utils/helpers.js";

/**
 * Chat component - displays conversation with a single bot
 */
export function Chat({
  bot,
  messages,
  status,
  input,
  streaming,
  onInputChange,
  onSend,
  onInterrupt,
  onBack,
  onOpenSettings,
  onDeleteMessage,
  onClearChat,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useAutoResize(input);
  const bottomRef = useScrollFollow([messages, streaming]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0d0d14",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "52px 16px 12px",
          background: "#111118",
          borderBottom: "1px solid #1a1a26",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: bot.color,
            cursor: "pointer",
            display: "flex",
          }}
        >
          <BackIcon />
        </button>

        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: `${bot.color}20`,
            border: `1.5px solid ${bot.color}40`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
          }}
        >
          {bot.avatar}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "#f0f0f5" }}>
            {bot.name}
          </div>
          <div style={{ fontSize: 12, color: STATUS_COLOR[status] || "#555568" }}>
            {STATUS_LABEL[status] || "…"}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            style={{
              background: "none",
              border: "none",
              color: "#555568",
              cursor: "pointer",
              padding: 6,
              display: "flex",
            }}
          >
            <KebabMenuIcon />
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 10 }}
                onClick={() => setShowMenu(false)}
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 8,
                  background: "#1c1c2e",
                  borderRadius: 10,
                  padding: 4,
                  zIndex: 20,
                  boxShadow: "0 4px 20px #00000060",
                  border: "1px solid #2a2a3e",
                  minWidth: 160,
                }}
              >
                <button
                  onClick={() => {
                    onOpenSettings();
                    setShowMenu(false);
                  }}
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
                    color: "#e0e0f0",
                    fontSize: 14,
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#ffffff10")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <SettingsIcon /> Settings
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Clear all messages with ${bot.name}?`)) {
                      onClearChat();
                      setShowMenu(false);
                    }
                  }}
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
                    color: "#ef4444",
                    fontSize: 14,
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#ffffff10")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  Clear Chat
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 16px 8px",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={() => setShowMenu(false)}
      >
        {messages.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{bot.avatar}</div>
            <div
              style={{ color: "#f0f0f5", fontWeight: 600, fontSize: 17, marginBottom: 6 }}
            >
              {bot.name}
            </div>
            <div style={{ color: "#444455", fontSize: 14 }}>{bot.tagline}</div>
            <div
              style={{
                marginTop: 16,
                padding: "10px 16px",
                background: "#1c1c28",
                borderRadius: 10,
                fontSize: 13,
                color: "#555568",
                lineHeight: 1.6,
              }}
            >
              {bot.protocol === "openclaw"
                ? `Connects to OpenClaw gateway at\nws://${bot.host}:${bot.port}`
                : `Connects to Hermes API at\nhttp://${bot.host}:${bot.port}`}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id || i}
            msg={msg}
            bot={bot}
            onDelete={() => onDeleteMessage(msg.id)}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: "10px 12px 32px",
          background: "#111118",
          borderTop: "1px solid #1a1a26",
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={streaming ? "Agent is responding…" : "Message"}
          disabled={streaming}
          rows={1}
          style={{
            flex: 1,
            background: "#1c1c28",
            border: "none",
            borderRadius: 22,
            padding: "11px 16px",
            fontSize: 15,
            color: "#e8e8f0",
            outline: "none",
            resize: "none",
            fontFamily: "inherit",
            lineHeight: 1.5,
            maxHeight: 120,
          }}
        />

        {streaming ? (
          <button
            onClick={onInterrupt}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "#ef4444",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: input.trim() ? bot.color : "#1c1c28",
              border: "none",
              cursor: input.trim() ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: input.trim() ? "#0d0d14" : "#333347",
              transition: "background .15s",
              flexShrink: 0,
            }}
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}
