import React from "react";
import {
  SearchIcon,
  PlusIcon,
  SettingsIcon,
  StatusDot,
} from "./icons/Icons.jsx";
import {
  getLastMessage,
  getUnreadCount,
  formatUnread,
} from "../utils/helpers.js";
import { isFieldVisible, getModeLabel } from "../utils/modeConfig.js";

/**
 * Inbox component - shows list of all bots
 */
export function Inbox({
  bots,
  history,
  statuses,
  search,
  onSearch,
  onOpenChat,
  onOpenSettings,
  onAddBot,
  mode,
  onToggleMode,
}) {
  const filtered = bots.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#111118",
      }}
    >
      {/* Header */}
      <div style={{ padding: "52px 20px 12px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#f0f0f5",
                letterSpacing: "-0.02em",
              }}
            >
              Messages
            </h1>
            <button
              onClick={onToggleMode}
              style={{
                background: mode === "dev" ? "#34d39920" : "#1c1c28",
                border: mode === "dev" ? "1px solid #34d39940" : "1px solid #2c2c38",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                color: mode === "dev" ? "#34d399" : "#888",
                cursor: "pointer",
                transition: "all .15s",
              }}
              title={`Switch to ${mode === "basic" ? "Dev" : "Basic"} mode`}
            >
              {getModeLabel(mode)}
            </button>
          </div>
          <button
            onClick={onAddBot}
            style={{
              background: "#1c1c28",
              border: "none",
              borderRadius: 10,
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
              cursor: "pointer",
            }}
          >
            <PlusIcon />
          </button>
        </div>

        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#1c1c26",
            borderRadius: 12,
            padding: "9px 14px",
          }}
        >
          <SearchIcon />
          <input
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              fontSize: 15,
              color: "#e0e0ea",
              fontFamily: "inherit",
            }}
            placeholder="Search agents…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bot List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
        {filtered.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "#444455",
              fontSize: 14,
            }}
          >
            {search ? "No agents match your search" : "No agents — tap + to add one"}
          </div>
        )}

        {filtered.map((bot) => {
          const lastMsg = getLastMessage(history, bot.id);
          const unreadCount = getUnreadCount(history, bot.id);
          const unreadBadge = formatUnread(unreadCount);
          const status = statuses[bot.id] || "disconnected";

          return (
            <div
              key={bot.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 20px",
                cursor: "pointer",
                transition: "background .12s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#17171f")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
              onClick={() => onOpenChat(bot.id)}
            >
              {/* Avatar with status dot */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: `${bot.color}20`,
                    border: `1.5px solid ${bot.color}40`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}
                >
                  {bot.avatar}
                </div>
                <div
                  style={{
                    position: "absolute",
                    bottom: 1,
                    right: 1,
                  }}
                >
                  <StatusDot status={status} border="#111118" />
                </div>
              </div>

              {/* Bot info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 3,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{ fontWeight: 600, fontSize: 16, color: "#f0f0f5" }}
                    >
                      {bot.name}
                    </span>
                    {isFieldVisible("protocolBadge", mode) && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#333347",
                          background: "#1c1c28",
                          padding: "1px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {bot.protocol === "openclaw" ? "WS" : "HTTP"}
                      </span>
                    )}
                  </div>
                  {lastMsg && (
                    <span
                      style={{
                        fontSize: 12,
                        color: unreadCount > 0 ? bot.color : "#44445a",
                      }}
                    >
                      {lastMsg.time}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: "#555568",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 210,
                    }}
                  >
                    {lastMsg
                      ? lastMsg.role === "user"
                        ? `You: ${lastMsg.text}`
                        : lastMsg.text
                      : bot.tagline}
                  </span>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {unreadBadge && (
                      <div
                        style={{
                          background: bot.color,
                          color: "#0d0d14",
                          borderRadius: "50%",
                          width: 20,
                          height: 20,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {unreadBadge}
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSettings(bot);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#333347",
                        cursor: "pointer",
                        padding: 2,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <SettingsIcon />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
