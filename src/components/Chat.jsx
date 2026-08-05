import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { MessageBubble } from "./MessageBubble.jsx";
import {
  BackIcon,
  SettingsIcon,
  SendIcon,
  KebabMenuIcon,
  MicIcon,
  SpeakerIcon,
} from "./icons/Icons.jsx";
import { useAutoResize } from "../hooks/useAutoResize.js";
import { useScrollFollow } from "../hooks/useScrollFollow.js";
import { STATUS_LABEL, STATUS_COLOR } from "../utils/helpers.js";

/** Validate a CSS color string — only allow hex, rgb(a), hsl(a), named colors */
const SAFE_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.%,\s/]+\)|hsla?\(\s*[\d.%,\s/]+\)|[a-zA-Z]{1,20})$/;
function safeColor(color, fallback = "#818cf8") {
  return typeof color === "string" && SAFE_COLOR_RE.test(color.trim())
    ? color.trim()
    : fallback;
}

function isFullUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLocalhostHost(value) {
  const host = String(value || "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function getDraymondConnectionLabel(bot) {
  const host = String(bot.host || "127.0.0.1").trim();
  if (isFullUrl(host)) {
    return `${host.replace(/\/$/, "")}/api/v1`;
  }
  if (!isLocalhostHost(host)) {
    return `https://${host}/api/v1`;
  }
  return `http://${host}:${bot.port || 8644}/api/v1`;
}

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
  onNtfyAction,
  unreadNotifications = 0,
  draymondChains = [],
  onClearUnread,
  voiceMicActive = false,
  voiceEnabled = false,
  onMicPointerDown = null,
  onMicPointerUp = null,
  onMicCancel = null,
  onToggleSpeak = null,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showChainStrip, setShowChainStrip] = useState(false);
  const inputRef = useAutoResize(input);
  const bottomRef = useScrollFollow([messages, streaming]);
  const color = safeColor(bot.color);
  const isDraymond = bot.protocol === "draymond";

  // Close menu on Escape key
  useEffect(() => {
    if (!showMenu) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShowMenu(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showMenu]);

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
          aria-label="Back"
          style={{
            background: "none",
            border: "none",
            color: color,
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
            background: `${color}20`,
            border: `1.5px solid ${color}40`,
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

        {/* Notification badge (Draymond only) */}
        {isDraymond && unreadNotifications > 0 && (
          <button
            onClick={() => {
              if (onClearUnread) onClearUnread();
            }}
            aria-label={`${unreadNotifications} unread notifications`}
            title="Click to clear"
            style={{
              position: "relative",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                background: "#ef4444",
                color: "#fff",
                fontSize: 9,
                fontWeight: 700,
                borderRadius: "50%",
                width: 16,
                height: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              {unreadNotifications > 99 ? "99" : unreadNotifications}
            </span>
          </button>
        )}

        {/* Chain activity toggle (Draymond only) */}
        {isDraymond && draymondChains.length > 0 && (
          <button
            onClick={() => setShowChainStrip((prev) => !prev)}
            aria-label="Toggle chain activity"
            title={showChainStrip ? "Hide chain activity" : "Show chain activity"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: showChainStrip ? "#34d399" : "#555568",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>
        )}

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            aria-label="Chat menu"
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

      {/* Chain activity strip (Draymond only) */}
      {isDraymond && showChainStrip && draymondChains.length > 0 && (
        <div
          style={{
            padding: "8px 16px",
            background: "#111118",
            borderBottom: "1px solid #1a1a26",
            maxHeight: 120,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#666680",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Chain Activity
          </div>
          {draymondChains.slice(-5).reverse().map((chain, i) => {
            const statusColor =
              chain.type === "chain_completed" ? "#34d399" :
              chain.type === "chain_failed" ? "#ef4444" :
              chain.type === "chain_started" ? "#60a5fa" :
              "#f59e0b";
            const label =
              chain.type === "chain_completed" ? "Done" :
              chain.type === "chain_failed" ? "Failed" :
              chain.type === "chain_started" ? "Running" :
              "Step";
            return (
              <div
                key={chain.chain_instance_id || i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  fontSize: 12,
                  color: "#c0c0d0",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: statusColor,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {chain.chain_name || chain.chain_slug || "chain"}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: statusColor,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

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
            {(() => {
              if (bot.protocol === "openclaw") {
                return `Connects to OpenClaw gateway at\nws://${bot.host}:${bot.port}`;
              }
              if (bot.protocol === "uplift-bridge") {
                return `Connects to Uplift Bridge at\nhttp://${bot.host}:${bot.port}`;
              }
              if (bot.protocol === "draymond") {
                return `Connects to Draymond Orchestrator at\n${getDraymondConnectionLabel(bot)}`;
              }
              if (bot.protocol === "subteam") {
                return `Connects to SubTeam agent at\nhttp://${bot.host}:${bot.port}`;
              }
              return `Connects to Hermes API at\nhttp://${bot.host}:${bot.port}`;
            })()}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // For bot messages, find the nearest preceding user message text
          // so OnDeviceInsights can use it as context for the insight prompt.
          let lastUserMessage = "";
          if (msg.role !== "user") {
            for (let j = i - 1; j >= 0; j--) {
              if (messages[j].role === "user") {
                lastUserMessage = messages[j].text || "";
                break;
              }
            }
          }
          return (
            <MessageBubble
              key={msg.id || i}
              msg={msg}
              bot={bot}
              onDelete={() => onDeleteMessage(msg.id)}
              onNtfyAction={onNtfyAction}
              lastUserMessage={lastUserMessage}
            />
          );
        })}

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

        {onMicPointerDown && (
          <button
            type="button"
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerLeave={onMicCancel}
            aria-label={voiceMicActive ? "Release to send" : "Hold to talk"}
            title={voiceMicActive ? "Release to send" : "Hold to talk"}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: voiceMicActive ? "#ef4444" : "#9ca3af",
              flexShrink: 0,
            }}
          >
            <MicIcon />
          </button>
        )}
        {onToggleSpeak && (
          <button
            type="button"
            onClick={onToggleSpeak}
            aria-label={voiceEnabled ? "Auto-speak on" : "Auto-speak off"}
            title={voiceEnabled ? "Auto-speak on" : "Auto-speak off"}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: voiceEnabled ? "#818cf8" : "#9ca3af",
              flexShrink: 0,
            }}
          >
            <SpeakerIcon />
          </button>
        )}

        {streaming ? (
          <button
            onClick={onInterrupt}
            aria-label="Stop responding"
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
            aria-label="Send message"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: input.trim() ? color : "#1c1c28",
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

Chat.propTypes = {
  bot: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    avatar: PropTypes.string,
    color: PropTypes.string.isRequired,
    tagline: PropTypes.string,
    protocol: PropTypes.string,
  }).isRequired,
  messages: PropTypes.array.isRequired,
  status: PropTypes.string.isRequired,
  input: PropTypes.string.isRequired,
  streaming: PropTypes.bool.isRequired,
  onInputChange: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired,
  onInterrupt: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  onOpenSettings: PropTypes.func.isRequired,
  onDeleteMessage: PropTypes.func.isRequired,
  onClearChat: PropTypes.func.isRequired,
  onNtfyAction: PropTypes.func,
  unreadNotifications: PropTypes.number,
  draymondChains: PropTypes.array,
  onClearUnread: PropTypes.func,
  voiceMicActive: PropTypes.bool,
  voiceEnabled: PropTypes.bool,
  onMicPointerDown: PropTypes.func,
  onMicPointerUp: PropTypes.func,
  onMicCancel: PropTypes.func,
  onToggleSpeak: PropTypes.func,
};
