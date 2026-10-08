import React, { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { DraymondOrchestratorClient } from "../protocols/DraymondOrchestratorClient.js";

const card = {
  background: "#15151f",
  border: "1px solid #22222e",
  borderRadius: 12,
  padding: "14px 16px",
  marginBottom: 10,
};

const panel = {
  background: "#13141d",
  border: "1px solid #1f1f2c",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 10,
};

const sectionTitle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#555568",
  margin: "12px 0 6px",
};

const statNum = { fontSize: 20, fontWeight: 700, color: "#f0f0f5" };
const statLabel = {
  fontSize: 10,
  color: "#666679",
  marginTop: 2,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const actionBtn = {
  background: "#22d3ee",
  border: "none",
  borderRadius: 10,
  padding: "7px 14px",
  color: "#05060a",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostBtn = {
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

const fmtMoney = (usd) => {
  const n = Number(usd) || 0;
  if (n >= 1000) {
    const rounded = Math.round((n / 1000) * 10) / 10;
    return `$${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return `$${Math.round(n)}`;
};

/**
 * EcosystemStatusCard — the one-push "state of the ecosystem" card.
 *
 * Triggers Draymond's single /api/v1/snapshot export at the push of a button
 * and renders it in a consistent, professional layout: a narrative paragraph
 * describing the state of things, a KPI grid, strategy + marketing team
 * updates, and recommended actions. Auto-refresh is OFF by default — every
 * snapshot call runs an LLM narrative server-side, so polling would burn
 * tokens; flip it on explicitly for a live session.
 */
export function EcosystemStatusCard({
  bot,
  autoRefreshDefault = false,
  refreshMs = 30_000,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(autoRefreshDefault);
  const [lastUpdated, setLastUpdated] = useState(null);

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

  const pull = useCallback(async () => {
    if (!bot) {
      setError("No Draymond orchestrator connected.");
      return;
    }
    setLoading(true);
    const client = new DraymondOrchestratorClient(bot.host, bot.port, bot.token);
    const snapshot = await client.getEcosystemStatus();
    if (!mountedRef.current) return;
    setLoading(false);
    if (!snapshot || snapshot.ok === false) {
      setError("Could not reach Draymond — snapshot unavailable.");
      return;
    }
    setData(snapshot);
    setError(null);
    setLastUpdated(new Date());
  }, [bot]);

  useEffect(() => {
    pull();
    if (!auto) return undefined;
    const id = setInterval(pull, refreshMs);
    return () => clearInterval(id);
  }, [pull, auto, refreshMs]);

  const mission = data?.mission;
  const fleet = data?.fleet;
  const teams = data?.teams;
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  const criticals = Array.isArray(fleet?.criticalMoments) ? fleet.criticalMoments : [];

  return (
    <div style={card}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f0f5" }}>
            Ecosystem status
          </div>
          {data && (
            <span>
              {pill(
                data.narrativeSource === "fallback" ? "#f59e0b" : "#22d3ee",
                data.narrativeSource === "fallback" ? "calibrated" : "live"
              )}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={pull} disabled={loading} style={{ ...actionBtn, opacity: loading ? 0.6 : 1 }}>
            {loading ? "…" : "Pull status"}
          </button>
          <button
            onClick={() => setAuto((v) => !v)}
            style={{
              ...ghostBtn,
              background: auto ? "#22d3ee" : "#1c1c28",
              color: auto ? "#05060a" : "#888",
              border: auto ? "1px solid #22d3ee" : "1px solid #2c2c38",
            }}
            aria-pressed={auto}
          >
            {auto ? "Auto on" : "Auto off"}
          </button>
        </div>
      </div>

      {lastUpdated && (
        <div style={{ fontSize: 10, color: "#555568", marginTop: 4 }}>
          updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "#ef4444", marginTop: 10 }}>{error}</div>
      )}

      {!data && !error && loading && (
        <div style={{ fontSize: 12, color: "#666679", marginTop: 10 }}>
          Pulling status…
        </div>
      )}

      {data && mission && fleet && (
        <>
          {/* Narrative — the paragraph describing the state of things */}
          {data.narrative && (
            <div style={{ ...panel, marginTop: 10 }}>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "#e0e0ea" }}>
                {data.narrative}
              </div>
            </div>
          )}

          {/* KPI grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
            {[
              {
                num: fmtMoney(mission.revenueUsd || 0),
                label: "settled revenue",
                color: mission.revenueUsd ? "#fbbf24" : "#888",
              },
              { num: fmtMoney(mission.totalMonthlyTarget || 0), label: "monthly target", color: "#22d3ee" },
              { num: fmtMoney(mission.gapUsd || 0), label: "gap to target", color: "#ef4444" },
              { num: mission.velocity?.leads ?? 0, label: "active leads", color: mission.velocity?.leads ? "#22d3ee" : "#888" },
              {
                num: fleet.checked ? `${fleet.up}/${fleet.checked}` : "—",
                label: "agents up",
                color: fleet.down ? "#f59e0b" : "#22c55e",
              },
              {
                num: criticals.length,
                label: "critical alerts",
                color: criticals.length ? "#ef4444" : "#22c55e",
              },
              {
                num: teams?.marketing?.recommended || "—",
                label: "marketing focus",
                color: teams?.marketing?.recommended ? "#818cf8" : "#666679",
              },
              {
                num: fleet.sweepFresh ? "Fresh" : "Stale",
                label: "monitor",
                color: fleet.sweepFresh ? "#22c55e" : "#ef4444",
              },
            ].map((item) => (
              <div key={item.label} style={{ ...panel, marginBottom: 0, textAlign: "center" }}>
                <div style={{ ...statNum, fontSize: 17, color: item.color }}>{item.num}</div>
                <div style={statLabel}>{item.label}</div>
              </div>
            ))}
          </div>

          {/* Team updates */}
          <div style={sectionTitle}>TEAMS</div>
          <div style={{ ...panel, marginBottom: 0 }}>
            {teams?.strategy && (
              <div style={{ marginBottom: teams?.marketing ? 10 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ea" }}>
                  Strategy — {fmtMoney(teams.strategy.monthlyTarget || 0)}/mo target
                </div>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {(teams.strategy.services || []).map((s) => (
                    <div
                      key={s.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#666679",
                      }}
                    >
                      <span>{s.name}</span>
                      <span style={{ color: "#c9c9d8", fontWeight: 600 }}>
                        {fmtMoney(s.targetMonthly || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {teams?.marketing && (
              <div style={{ borderTop: teams?.strategy ? "1px solid #1f1f2c" : "none", paddingTop: teams?.strategy ? 10 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ea" }}>
                  Marketing — {teams.marketing.recommended || "no recommendation"}
                </div>
                {teams.marketing.rationale && (
                  <div style={{ fontSize: 11, color: "#666679", marginTop: 4 }}>
                    {teams.marketing.rationale}
                  </div>
                )}
                {teams.marketing.guard && (
                  <div style={{ marginTop: 6 }}>
                    {pill(
                      teams.marketing.guard.allowed ? "#22c55e" : "#ef4444",
                      teams.marketing.guard.allowed ? "guard passed" : "guard blocked"
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recommended actions */}
          {actions.length > 0 && (
            <>
              <div style={sectionTitle}>ACTIONS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {actions.map((a, i) => (
                  <div
                    key={`${a.priority}-${i}`}
                    style={{ ...panel, marginBottom: 0, display: "flex", gap: 8, alignItems: "flex-start" }}
                  >
                    {pill(a.priority === "critical" ? "#ef4444" : "#f59e0b", a.priority)}
                    <div style={{ fontSize: 12, color: "#e0e0ea", lineHeight: 1.4 }}>{a.text}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Down agents */}
          {fleet.downAgents?.length > 0 && (
            <>
              <div style={sectionTitle}>DOWN AGENTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {fleet.downAgents.map((a) => (
                  <div
                    key={a.slug}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "#666679",
                    }}
                  >
                    <span style={{ color: "#c9c9d8", fontWeight: 600 }}>{a.name}</span>
                    <span style={{ color: "#ef4444" }}>{a.detail || "down"}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

EcosystemStatusCard.propTypes = {
  bot: PropTypes.shape({
    id: PropTypes.string,
    host: PropTypes.string,
    port: PropTypes.number,
    token: PropTypes.string,
  }),
  autoRefreshDefault: PropTypes.bool,
  refreshMs: PropTypes.number,
};