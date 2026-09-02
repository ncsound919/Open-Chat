import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { BotAvatar } from "./BotAvatar.jsx";
import { getLastMessage, getUnreadCount, isAgentOnline } from "../utils/helpers.js";

const CARD = {
  background: "#15151f",
  border: "1px solid #22222e",
  borderRadius: 14,
  padding: "14px 16px",
  cursor: "pointer",
  textAlign: "left",
  color: "#e0e0ea",
  display: "flex",
  alignItems: "center",
  gap: 12,
  transition: "transform .12s, border-color .12s",
};

/**
 * HomeScreen — the primary landing screen (not the message list). Greeting,
 * live status, labeled quick-nav cards, and recent conversations.
 */
export function HomeScreen({
  onOpenMenu,
  onNavigate,
  unread = 0,
  agents = {},
  modelStatus = "No model loaded",
  bots = [],
  history = {},
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const agentCount = useMemo(() => Object.keys(agents).length, [agents]);
  const onlineAgents = useMemo(
    () => Object.values(agents).filter((a) => isAgentOnline(a?.status)).length,
    [agents]
  );

  const recent = useMemo(
    () =>
      bots
        .map((b) => {
          const last = getLastMessage(history, b.id);
          const unreadCount = getUnreadCount(history, b.id);
          return { bot: b, last, unreadCount };
        })
        .filter((r) => r.last)
        .sort((a, b) => (b.last.time > a.last.time ? 1 : -1))
        .slice(0, 4),
    [bots, history]
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
      <div style={{ padding: "52px 20px 12px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            style={iconBtn}
          >
            <span style={{ fontSize: 20 }}>☰</span>
          </button>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#f0f0f5",
              letterSpacing: "-0.02em",
            }}
          >
            Open Chat
          </h1>
          <div style={{ width: 40 }} />
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#fff" }}>{greeting}</div>
          <div style={{ fontSize: 13, color: "#666679", marginTop: 2 }}>
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 24px" }}>
        {/* Status strip */}
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <div style={statCard}>
            <div style={statNum}>{onlineAgents}</div>
            <div style={statLabel}>agents online</div>
          </div>
          <div style={statCard}>
            <div style={{ ...statNum, color: unread ? "#22d3ee" : "#888" }}>{unread}</div>
            <div style={statLabel}>unread</div>
          </div>
          <div style={{ ...statCard, flex: 1.4 }}>
            <div style={{ ...statNum, fontSize: 13, color: modelStatus === "No model loaded" ? "#888" : "#34d399" }}>
              {modelStatus === "No model loaded" ? "—" : "●"}
            </div>
            <div style={statLabel}>{modelStatus}</div>
          </div>
        </div>

        {/* Quick navigation */}
        <div style={{ marginBottom: 6 }}>
          {[
            { id: "chats", icon: "💬", title: "Chats", subtitle: `${bots.length} conversations` },
            { id: "stats", icon: "📊", title: "Stats", subtitle: "Fleet health & activity at a glance" },
            { id: "agents", icon: "🤖", title: "Agents", subtitle: `${agentCount} in your fleet` },
            { id: "models", icon: "🧠", title: "Models", subtitle: "On-device AI & downloads" },
          ].map((c) => (
            <button key={c.id} onClick={() => onNavigate(c.id)} style={{ ...CARD, width: "100%", marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>{c.icon}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>{c.title}</span>
                <span style={{ display: "block", fontSize: 12, color: "#666679", marginTop: 1 }}>
                  {c.subtitle}
                </span>
              </span>
              <span style={{ color: "#555568", fontSize: 18 }}>›</span>
            </button>
          ))}
        </div>

        {/* Recent conversations */}
        {recent.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "#555568", margin: "8px 0" }}>
              RECENT
            </div>
            {recent.map(({ bot, last, unreadCount }) => (
              <div
                key={bot.id}
                onClick={() => onNavigate("chats", bot.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 4px",
                  cursor: "pointer",
                }}
              >
                <BotAvatar bot={bot} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f5" }}>{bot.name}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#555568",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {last.role === "user" ? `You: ${last.text}` : last.text}
                  </div>
                </div>
                {unreadCount > 0 && (
                  <span
                    style={{
                      background: "#22d3ee",
                      color: "#05060a",
                      borderRadius: "50%",
                      minWidth: 20,
                      height: 20,
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 5px",
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn = {
  background: "#1c1c28",
  border: "1px solid #2c2c38",
  borderRadius: 10,
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
  cursor: "pointer",
};

const statCard = {
  flex: 1,
  background: "#15151f",
  border: "1px solid #22222e",
  borderRadius: 12,
  padding: "12px 14px",
};

const statNum = { fontSize: 22, fontWeight: 700, color: "#f0f0f5" };
const statLabel = { fontSize: 11, color: "#666679", marginTop: 2 };

HomeScreen.propTypes = {
  onOpenMenu: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
  unread: PropTypes.number,
  agents: PropTypes.object,
  modelStatus: PropTypes.string,
  bots: PropTypes.array,
  history: PropTypes.object,
};
