import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { BotAvatar } from "./BotAvatar.jsx";
import { StatusDot } from "./icons/Icons.jsx";
import { agentStatusRank } from "../utils/helpers.js";

/**
 * AgentsScreen — live roster of every agent discovered from the Draymond
 * orchestrator (auto-populated on connect) plus any on-device/local agents.
 */
export function AgentsScreen({
  agents,
  bots = [],
  history = {},
  activeId = null,
  pinnedIds = [],
  onOpenChat,
  onOpenSettings,
  onOpenMenu = null,
  draymondOrigin = "",
  fleet = null,
}) {
  const [busyAgent, setBusyAgent] = useState(null); // `${agentId}:${kind}`
  const [feedback, setFeedback] = useState({}); // agentId → {kind, text}

  /** Run a wake/direct action against the fleet controller. */
  const runFleetAction = useCallback(
    async (agentId, kind) => {
      if (!fleet || typeof fleet[kind] !== "function") return;
      const key = `${agentId}:${kind}`;
      if (busyAgent === key) return;
      setBusyAgent(key);
      setFeedback((prev) => ({ ...prev, [agentId]: undefined }));
      const res = await fleet[kind](agentId);
      const ok = res?.ok === true;
      setFeedback((prev) => ({
        ...prev,
        [agentId]: {
          kind: ok ? "ok" : "error",
          text:
            kind === "ping"
              ? ok
                ? "Pinged — healthy observation recorded"
                : res?.error || "Ping failed"
              : ok
              ? "Recovery initiated"
              : res?.error || "Recovery failed",
        },
      }));
      setBusyAgent(null);
    },
    [fleet, busyAgent]
  );

  const fleetReady = !!fleet && typeof fleet.isReady === "function" && fleet.isReady();
  const botForAgent = useCallback(
    (agentId) =>
      bots.find(
        (b) => b.agentRef === agentId || b.id === `agent-${agentId}` || b.id === agentId
      ),
    [bots]
  );

  const getAgentChatMeta = useCallback(
    (agentId) => {
      const bot = botForAgent(agentId);
      if (!bot) return { hasChat: false, lastTime: 0, lastText: "", isPinned: false };
      const msgs = history[bot.id] || [];
      const last = msgs[msgs.length - 1];
      const lastTime = last?.time || last?.timestamp || (bot.id === activeId ? Date.now() : 0);
      const lastText = last?.text || last?.content || "";
      const isPinned = pinnedIds.includes(bot.id);
      return {
        hasChat: msgs.length > 0 || bot.id === activeId,
        lastTime,
        lastText,
        isPinned,
        bot,
      };
    },
    [history, activeId, pinnedIds, botForAgent]
  );

  // Sort: Active chats first (by recency), then online agents, then others.
  const list = useMemo(() => {
    const entries = Object.values(agents ?? {});
    const seenIds = new Set(entries.map((a) => a.id ?? a.slug));
    const extraBots = (bots || [])
      .filter(
        (b) =>
          !seenIds.has(b.id) &&
          !seenIds.has(b.agentRef) &&
          (history[b.id]?.length > 0 || b.id === activeId)
      )
      .map((b) => ({
        id: b.id,
        name: b.name,
        status: "active",
        avatar: b.avatar || "🤖",
        color: b.color || "#22d3ee",
        capabilities: b.protocol ? [b.protocol] : [],
      }));

    const allAgents = [...entries, ...extraBots];

    return allAgents
      .map((a) => {
        const agentId = a.id ?? a.slug;
        const meta = getAgentChatMeta(agentId);
        let r = 5;
        if (meta.hasChat) {
          r = 0; // Top priority: active chats
        } else {
          // agentStatusRank is 0..4 (0 = online) — offset so active chats (0)
          // stay above every health rank.
          r = agentStatusRank(a?.status) + 1;
        }
        return { a, r, lastTime: meta.lastTime, meta };
      })
      .sort((x, y) => {
        if (x.r !== y.r) return x.r - y.r;
        if (x.r === 0) {
          if (x.meta.isPinned !== y.meta.isPinned) return y.meta.isPinned ? 1 : -1;
          return y.lastTime - x.lastTime;
        }
        return (x.a?.name ?? "").localeCompare(y.a?.name ?? "");
      })
      .map((x) => x.a);
  }, [agents, bots, history, activeId, getAgentChatMeta]);

  const statusFor = (agent) => {
    if (!agent) return "unknown";
    return String(agent.status ?? "unknown").toLowerCase();
  };

  /** Resolve an agent's avatar URL against the Draymond origin or its bot's host. */
  const resolveAgentAvatarUrl = (agent, bot) => {
    const raw = agent.avatarUrl || `/avatars/${agent.id ?? agent.slug}.png`;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) {
      if (draymondOrigin) return `${draymondOrigin}${raw}`;
      if (bot?.host) return `http://${bot.host}:${bot.port || 8644}${raw}`;
    }
    return "";
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
                    avatar: agent.avatar ?? "🤖",
                    avatarUrl: resolveAgentAvatarUrl(agent, bot),
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: "#f0f0f5" }}>
                      {agent.name ?? agentId}
                    </span>
                    {getAgentChatMeta(agentId).hasChat && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#22d3ee",
                          background: "#22d3ee1c",
                          border: "1px solid #22d3ee38",
                          borderRadius: 6,
                          padding: "1px 6px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        ● Active Chat
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "#555568" }}>{agentId}</span>
                </div>

                {getAgentChatMeta(agentId).lastText && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#88889a",
                      marginTop: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {getAgentChatMeta(agentId).lastText}
                  </div>
                )}

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
                  {fleetReady && (
                    <>
                      <button
                        onClick={() => runFleetAction(agentId, "ping")}
                        disabled={busyAgent === `${agentId}:ping`}
                        title="Record a healthy observation (wake the repair gate)"
                        style={{
                          background: "none",
                          border: "1px solid #34d39960",
                          color: "#34d399",
                          borderRadius: 8,
                          padding: "5px 12px",
                          fontSize: 12,
                          cursor: busyAgent === `${agentId}:ping` ? "default" : "pointer",
                        }}
                      >
                        {busyAgent === `${agentId}:ping` ? "Pinging…" : "Ping / wake"}
                      </button>
                      <button
                        onClick={() => runFleetAction(agentId, "recover")}
                        disabled={busyAgent === `${agentId}:recover`}
                        title="Initiate Draymond's recovery protocol for this agent"
                        style={{
                          background: "none",
                          border: "1px solid #f59e0b60",
                          color: "#f59e0b",
                          borderRadius: 8,
                          padding: "5px 12px",
                          fontSize: 12,
                          cursor: busyAgent === `${agentId}:recover` ? "default" : "pointer",
                        }}
                      >
                        {busyAgent === `${agentId}:recover` ? "Recovering…" : "Recover"}
                      </button>
                    </>
                  )}
                </div>
                {feedback[agentId] && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: feedback[agentId].kind === "ok" ? "#34d399" : "#ef4444",
                    }}
                  >
                    {feedback[agentId].text}
                  </div>
                )}
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
  history: PropTypes.object,
  activeId: PropTypes.string,
  pinnedIds: PropTypes.array,
  onOpenChat: PropTypes.func.isRequired,
  onOpenSettings: PropTypes.func.isRequired,
  onOpenMenu: PropTypes.func,
  draymondOrigin: PropTypes.string,
  fleet: PropTypes.object,
};
