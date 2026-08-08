import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { BotAvatar } from "./BotAvatar.jsx";
import { StatusDot } from "./icons/Icons.jsx";

/**
 * AgentsScreen — live roster of every agent discovered from the Draymond
 * orchestrator (auto-populated on connect) plus any on-device/local agents.
 */
export function AgentsScreen({
  agents,
  bots,
  onOpenChat,
  onOpenSettings,
  onOpenMenu = null,
}) {
  const list = useMemo(() => {
    const entries = Object.values(agents ?? {});
    return entries.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [agents]);

  const botForAgent = (agentId) =>
    bots.find((b) => b.agentRef === agentId || b.id === `agent-${agentId}`);

  const statusFor = (agent) => {
    if (!agent) return "unknown";
    return String(agent.status ?? "unknown").toLowerCase();
  };

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
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onOpenMenu && (
              <button
                onClick={onOpenMenu}
                aria-label="Open navigation menu"
                style={menuBtn}
              >
                ☰
              </button>
            )}
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#f0f0f5",
                letterSpacing: "-0.02em",
              }}
            >
              Agents
            </h1>
          </div>
        </div>
        <p style={{ color: "#666679", fontSize: 13, margin: 0 }}>
          Discovered from the Draymond orchestrator · refresh by reopening the
          Draymond chat
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
        {list.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "60px 24px",
              color: "#444455",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            No agents discovered yet.
            <br />
            Connect the <b style={{ color: "#22d3ee" }}>Draymond</b> bot in
            Chats and its fleet will appear here.
          </div>
        )}

        {list.map((agent) => {
          const agentId = agent.id ?? agent.slug;
          const bot = botForAgent(agentId);
          const capabilities = Array.isArray(agent.capabilities)
            ? agent.capabilities.map((c) =>
                typeof c === "string" ? c : c?.label ?? c?.id ?? ""
              )
            : [];

          return (
            <div
              key={agentId}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "12px 20px",
                borderBottom: "1px solid #171720",
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <BotAvatar
                  bot={{
                    id: agentId,
                    name: agent.name ?? agentId,
                    avatar: agent.avatarUrl ? "" : agent.avatar ?? "🤖",
                    avatarUrl: agent.avatarUrl || `/avatars/${agentId}.png`,
                    color: "#22d3ee",
                    host: bot?.host,
                    port: bot?.port,
                  }}
                  size={48}
                />
                <div style={{ position: "absolute", bottom: 1, right: 1 }}>
                  <StatusDot status={statusFor(agent)} border="#111118" />
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 15, color: "#f0f0f5" }}>
                    {agent.name ?? agentId}
                  </span>
                  <span style={{ fontSize: 11, color: "#555568" }}>{agentId}</span>
                </div>

                {capabilities.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {capabilities.slice(0, 6).map((cap, i) => (
                      <span
                        key={`${cap}-${i}`}
                        style={{
                          fontSize: 10,
                          color: "#9fe8d5",
                          background: "#34d39918",
                          border: "1px solid #34d39930",
                          borderRadius: 6,
                          padding: "2px 7px",
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                    {capabilities.length > 6 && (
                      <span style={{ fontSize: 10, color: "#555568" }}>
                        +{capabilities.length - 6}
                      </span>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => onOpenChat(bot?.id ?? agentId)}
                    style={{
                      background: "#22d3ee",
                      color: "#05060a",
                      border: "none",
                      borderRadius: 8,
                      padding: "5px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Chat
                  </button>
                  {bot && (
                    <button
                      onClick={() => onOpenSettings(bot)}
                      style={{
                        background: "none",
                        border: "1px solid #2c2c38",
                        color: "#88889a",
                        borderRadius: 8,
                        padding: "5px 14px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Settings
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const menuBtn = {
  background: "#1c1c28",
  border: "1px solid #2c2c38",
  borderRadius: 10,
  width: 36,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
  cursor: "pointer",
  fontSize: 16,
};

AgentsScreen.propTypes = {
  agents: PropTypes.object,
  bots: PropTypes.array,
  onOpenChat: PropTypes.func.isRequired,
  onOpenSettings: PropTypes.func.isRequired,
  onOpenMenu: PropTypes.func,
};
