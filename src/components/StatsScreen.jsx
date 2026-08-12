import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { BotAvatar } from "./BotAvatar.jsx";
import {
  hermesHealth,
  hermesHealthDetailed,
  hermesAgentInfo,
  hermesSkills,
} from "../protocols/HermesClient.js";
import { DraymondOrchestratorClient } from "../protocols/DraymondOrchestratorClient.js";

const STATUS_COLOR = {
  connected: "#22c55e",
  connecting: "#f59e0b",
  disconnected: "#555568",
  error: "#ef4444",
};

const card = {
  background: "#15151f",
  border: "1px solid #22222e",
  borderRadius: 12,
  padding: "12px 14px",
  marginBottom: 10,
};

const sectionTitle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#555568",
  margin: "14px 0 8px",
};

const statNum = { fontSize: 22, fontWeight: 700, color: "#f0f0f5" };
const statLabel = { fontSize: 11, color: "#666679", marginTop: 2 };

const menuBtn = {
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
  fontSize: 16,
};

const refreshBtn = {
  background: "#1c1c28",
  border: "1px solid #2c2c38",
  borderRadius: 10,
  padding: "6px 12px",
  color: "#c9c9d8",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const pill = (color, label) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 10,
      fontWeight: 700,
      color,
      background: `${color}1c`,
      borderRadius: 6,
      padding: "2px 8px",
      whiteSpace: "nowrap",
    }}
  >
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
      }}
    />
    {label}
  </span>
);

/**
 * StatsScreen — a live fleet dashboard. Shows per-bot connectivity + latency,
 * rich Hermes agent status (/health/detailed + /v1/capabilities), Draymond
 * orchestrator status (/api/v1/status), and local activity counters (messages,
 * tool calls, workflows, notifications). Auto-refreshes on an interval.
 */
export function StatsScreen({
  onOpenMenu,
  bots = [],
  statuses = {},
  history = {},
  toolLog = [],
  workflows = {},
  draymondNotifications = [],
  agentRegistry = {},
  unread = 0,
}) {
  const hermesBots = useMemo(
    () => bots.filter((b) => b.protocol === "hermes"),
    [bots]
  );
  const draymondBots = useMemo(
    () => bots.filter((b) => b.protocol === "draymond"),
    [bots]
  );

  const [hermesStats, setHermesStats] = useState({});
  const [draymondStats, setDraymondStats] = useState({});
  const [mission, setMission] = useState(null);
  const [heartbeats, setHeartbeats] = useState(null);
  const [auto, setAuto] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const timersRef = useRef([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const h = {};
    const d = {};

    // Hermes bots — health, detailed status, capabilities, skills, latency.
    await Promise.all(
      hermesBots.map(async (bot) => {
        const started = Date.now();
        const [health, detailed, caps, skills] = await Promise.all([
          hermesHealth(bot.host, bot.port, bot.token),
          hermesHealthDetailed(bot.host, bot.port, bot.token),
          hermesAgentInfo(bot.host, bot.port, bot.token),
          hermesSkills(bot.host, bot.port, bot.token).catch(() => []),
        ]);
        h[bot.id] = {
          latency: Date.now() - started,
          health,
          detailed,
          caps,
          skills,
        };
      })
    );

    // Draymond bots — orchestrator server status + latency, plus the revenue
    // pulse (mission dashboard) and fleet agent heartbeats from the first
    // reachable orchestrator.
    let missionData = null;
    let heartbeatMap = null;
    await Promise.all(
      draymondBots.map(async (bot) => {
        const client = new DraymondOrchestratorClient(bot.host, bot.port, bot.token);
        const started = Date.now();
        const status = await client.getServerStatus();
        d[bot.id] = { latency: Date.now() - started, status };
        if (status?.status === "online" && !missionData) {
          missionData = await client.getMissionDashboard();
          const hb = await client.getHeartbeats();
          heartbeatMap = hb?.heartbeats ?? null;
        }
      })
    );

    if (!mountedRef.current) return;
    setHermesStats(h);
    setDraymondStats(d);
    setMission(missionData);
    setHeartbeats(heartbeatMap);
    setLastUpdated(new Date());
    setRefreshing(false);
  }, [hermesBots, draymondBots]);

  useEffect(() => {
    refresh();
    if (!auto) return undefined;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh, auto]);

  const messageCount = Object.values(history).reduce(
    (sum, msgs) => sum + (Array.isArray(msgs) ? msgs.length : 0),
    0
  );
  const toolCallCount = Array.isArray(toolLog) ? toolLog.length : 0;
  const workflowCount = Object.keys(workflows || {}).length;
  const notificationCount = Array.isArray(draymondNotifications)
    ? draymondNotifications.length
    : 0;
  const agentCount = Object.keys(agentRegistry || {}).length;

  const hermesAgg = hermesBots.reduce(
    (acc, bot) => {
      const s = hermesStats[bot.id];
      if (s?.detailed) {
        acc.ready++;
        acc.activeAgents += Number(s.detailed.active_agents || 0);
      } else if (s?.health) {
        acc.healthy++;
      }
      if (s?.caps) acc.capable++;
      return acc;
    },
    { ready: 0, healthy: 0, activeAgents: 0, capable: 0 }
  );

  const draymondAgg = draymondBots.reduce(
    (acc, bot) => {
      const s = draymondStats[bot.id];
      if (s?.status?.status === "online") acc.online++;
      acc.clients += Number(s?.status?.connected_clients || 0);
      if (s?.status?.uptime_ms) {
        acc.uptimeMs = Math.max(acc.uptimeMs, s.status.uptime_ms);
      }
      return acc;
    },
    { online: 0, clients: 0, uptimeMs: 0 }
  );

  const fmtUptime = (ms) => {
    if (!ms) return "—";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  };

  const fmtMoney = (usd) => {
    const n = Number(usd) || 0;
    if (n >= 1000) {
      const rounded = Math.round((n / 1000) * 10) / 10;
      return `$${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
    }
    return `$${Math.round(n)}`;
  };

  const heartbeatEntries = useMemo(() => {
    if (!heartbeats || typeof heartbeats !== "object") return [];
    return Object.entries(heartbeats).map(([slug, hb]) => ({
      slug,
      hb: typeof hb === "object" && hb !== null ? hb : {},
    }));
  }, [heartbeats]);

  const upCount = heartbeatEntries.filter(({ hb }) => hb.up === true).length;
  const downCount = heartbeatEntries.length - upCount;
  const sortedHeartbeats = [...heartbeatEntries].sort(
    (a, b) => Number(b.hb.up === true) - Number(a.hb.up === true)
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
          }}
        >
          <button onClick={onOpenMenu} aria-label="Open navigation menu" style={menuBtn}>
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
            Stats
          </h1>
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
            }}
          >
            <button
              onClick={refresh}
              disabled={refreshing}
              style={{ ...refreshBtn, opacity: refreshing ? 0.6 : 1 }}
            >
              {refreshing ? "…" : "↻"}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setAuto((v) => !v)}
            style={{
              ...refreshBtn,
              background: auto ? "#22d3ee" : "#1c1c28",
              color: auto ? "#05060a" : "#888",
              border: auto ? "1px solid #22d3ee" : "1px solid #2c2c38",
            }}
          >
            {auto ? "Auto-refresh on" : "Auto-refresh off"}
          </button>
          {lastUpdated && (
            <span style={{ fontSize: 11, color: "#555568" }}>
              updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 28px" }}>
        {/* Fleet connectivity */}
        <div style={sectionTitle}>FLEET</div>
        {bots.length === 0 ? (
          <div style={card}>No agents configured. Add a bot in Chats → Settings.</div>
        ) : (
          bots.map((bot) => {
            const appStatus = statuses[bot.id] || "disconnected";
            const latency =
              hermesStats[bot.id]?.latency ?? draymondStats[bot.id]?.latency;
            const color = STATUS_COLOR[appStatus] || STATUS_COLOR.disconnected;
            return (
              <div key={bot.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
                <BotAvatar bot={bot} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f5" }}>
                    {bot.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#555568", marginTop: 1 }}>
                    {bot.protocol}
                    {latency !== undefined && ` · ${latency}ms`}
                  </div>
                </div>
                {pill(color, appStatus)}
              </div>
            );
          })
        )}

        {/* Hermes agent status */}
        {hermesBots.length > 0 && (
          <>
            <div style={sectionTitle}>HERMES</div>
            <div style={{ ...card, background: "#13141d" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0ea" }}>
                  Hermes Agent
                </div>
                {hermesAgg.ready > 0
                  ? pill("#22c55e", "ready")
                  : hermesAgg.healthy > 0
                  ? pill("#22d3ee", "online")
                  : pill("#555568", "offline")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <div style={{ ...statNum, fontSize: 18 }}>{hermesAgg.activeAgents}</div>
                <div style={statLabel}>active agents</div>
                <div style={{ ...statNum, fontSize: 18 }}>{hermesAgg.capable}</div>
                <div style={statLabel}>capabilities loaded</div>
              </div>
              {hermesBots.map((bot) => {
                const s = hermesStats[bot.id];
                if (!s) return null;
                const version =
                  s.detailed?.version || s.health?.version || s.caps?.platform || "—";
                const model = s.caps?.model || s.health?.model || "—";
                const gatewayState = s.detailed?.gateway_state || "—";
                const platforms = s.detailed?.platforms
                  ? Object.keys(s.detailed.platforms)
                  : [];
                const skillCount = Array.isArray(s.skills) ? s.skills.length : 0;
                return (
                  <div
                    key={bot.id}
                    style={{
                      marginTop: 10,
                      borderTop: "1px solid #1f1f2c",
                      paddingTop: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#666679",
                        marginBottom: 6,
                      }}
                    >
                      <span>model</span>
                      <span style={{ color: "#c9c9d8", fontWeight: 600 }}>{model}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#666679",
                        marginBottom: 6,
                      }}
                    >
                      <span>version</span>
                      <span style={{ color: "#c9c9d8", fontWeight: 600 }}>{version}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#666679",
                        marginBottom: 6,
                      }}
                    >
                      <span>gateway state</span>
                      <span style={{ color: "#c9c9d8", fontWeight: 600 }}>{gatewayState}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#666679",
                        marginBottom: 6,
                      }}
                    >
                      <span>skills</span>
                      <span style={{ color: "#c9c9d8", fontWeight: 600 }}>{skillCount}</span>
                    </div>
                    {platforms.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 5,
                          marginTop: 6,
                        }}
                      >
                        {platforms.slice(0, 6).map((p) => pill("#818cf8", p))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Draymond orchestrator status */}
        {draymondBots.length > 0 && (
          <>
            <div style={sectionTitle}>DRAYMOND</div>
            <div style={{ ...card, background: "#13141d" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0ea" }}>
                  Orchestrator
                </div>
                {draymondAgg.online > 0
                  ? pill("#22c55e", "online")
                  : pill("#555568", "offline")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <div style={{ ...statNum, fontSize: 18 }}>{draymondAgg.clients}</div>
                <div style={statLabel}>connected clients</div>
                <div style={{ ...statNum, fontSize: 18 }}>{agentCount}</div>
                <div style={statLabel}>fleet agents</div>
                <div style={{ ...statNum, fontSize: 18 }}>{fmtUptime(draymondAgg.uptimeMs)}</div>
                <div style={statLabel}>uptime</div>
                <div style={{ ...statNum, fontSize: 18 }}>{workflowCount}</div>
                <div style={statLabel}>active workflows</div>
              </div>
            </div>
          </>
        )}

        {/* Revenue pulse (mission dashboard) */}
        {mission && (
          <>
            <div style={sectionTitle}>MONEY</div>
            <div style={{ ...card, background: "#13141d" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0ea" }}>
                  Revenue pulse
                </div>
                {mission.totalMonthlyTarget
                  ? pill("#f59e0b", "mission target")
                  : pill("#555568", "no target")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <div style={{ ...statNum, fontSize: 18, color: mission.revenueUsd ? "#fbbf24" : "#888" }}>
                  {fmtMoney(mission.revenueUsd || 0)}
                </div>
                <div style={statLabel}>settled revenue</div>
                <div style={{ ...statNum, fontSize: 18 }}>{fmtMoney(mission.totalMonthlyTarget || 0)}</div>
                <div style={statLabel}>monthly target</div>
                <div style={{ ...statNum, fontSize: 18, color: "#ef4444" }}>
                  {fmtMoney(Math.max(0, (mission.totalMonthlyTarget || 0) - (mission.revenueUsd || 0)))}
                </div>
                <div style={statLabel}>gap to target</div>
                <div style={{ ...statNum, fontSize: 18 }}>{mission.velocity?.leads ?? 0}</div>
                <div style={statLabel}>active leads</div>
              </div>
              {mission.byService && (
                <div style={{ marginTop: 10, borderTop: "1px solid #1f1f2c", paddingTop: 10 }}>
                  {Object.entries(mission.byService).map(([svc, s]) => (
                    <div
                      key={svc}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#666679",
                        marginBottom: 5,
                      }}
                    >
                      <span style={{ textTransform: "capitalize" }}>{svc}</span>
                      <span style={{ color: "#c9c9d8", fontWeight: 600 }}>
                        {fmtMoney(s?.paid || 0)} paid · {fmtMoney(s?.won || 0)} won
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Fleet agent triage (heartbeats) */}
        {heartbeats && heartbeatEntries.length > 0 && (
          <>
            <div style={sectionTitle}>FLEET AGENTS</div>
            <div style={{ ...card, background: "#13141d", padding: "8px 10px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "2px 4px 8px",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0ea" }}>
                  Agent heartbeats
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {pill("#22c55e", `${upCount} up`)}
                  {pill("#ef4444", `${downCount} down`)}
                </div>
              </div>
              {sortedHeartbeats.map(({ slug, hb }) => {
                const up = hb.up === true;
                return (
                  <div
                    key={slug}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 4px",
                      borderTop: "1px solid #1f1f2c",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: up ? "#22c55e" : "#ef4444",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#e0e0ea",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {hb.name || slug}
                      </div>
                      {hb.detail && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#555568",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {hb.detail}
                        </div>
                      )}
                    </div>
                    {pill(up ? "#22c55e" : "#ef4444", up ? "up" : "down")}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Activity counters */}
        <div style={sectionTitle}>ACTIVITY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { num: messageCount, label: "messages" },
            { num: toolCallCount, label: "tool calls" },
            { num: workflowCount, label: "workflows" },
            { num: notificationCount, label: "notifications" },
            { num: unread, label: "unread" },
            { num: agentCount, label: "agents" },
          ].map((item) => (
            <div key={item.label} style={{ ...card, marginBottom: 0, textAlign: "center" }}>
              <div style={{ ...statNum, color: item.num ? "#22d3ee" : "#888" }}>
                {item.num}
              </div>
              <div style={statLabel}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

StatsScreen.propTypes = {
  onOpenMenu: PropTypes.func.isRequired,
  bots: PropTypes.array,
  statuses: PropTypes.object,
  history: PropTypes.object,
  toolLog: PropTypes.array,
  workflows: PropTypes.object,
  draymondNotifications: PropTypes.array,
  agentRegistry: PropTypes.object,
  unread: PropTypes.number,
};
