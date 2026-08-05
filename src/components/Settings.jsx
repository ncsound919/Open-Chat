import React, { useState, useMemo, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { BackIcon } from "./icons/Icons.jsx";
import { isLocalhost, maskToken } from "../utils/security.js";
import { isFieldVisible, getAvailableProtocols, getModeDefaults, MODES } from "../utils/modeConfig.js";

const PROTOCOL_DEFAULT_PORTS = {
  openclaw: "18789",
  hermes: "8642",
  "uplift-bridge": "8642",
  draymond: "8644",
  ntfy: "80",
  // subteam omitted intentionally — port is deployment-specific
};

/**
 * Settings panel for bot configuration
 * Supports both editing existing bots and creating new ones
 */
export function Settings({
  bot,
  isNew,
  onSave,
  onDelete,
  onBack,
  mode,
  onOpenAuditLog,
  onOpenToolConsole,
  onOpenDevPanel,
  onOpenTeamPanel,
  onOpenScheduler,
  draymondClient,
  draymondNotifications = [],
}) {
  // In Basic mode, pre-fill with mode defaults
  const [form, setForm] = useState(() => {
    if (isNew && mode === MODES.BASIC) {
      return { ...bot, ...getModeDefaults(mode) };
    }
    return { ...bot };
  });

  const updateField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const availableProtocols = useMemo(() => getAvailableProtocols(mode), [mode]);

  // ── Draymond remote management state ──────────────────────────────────────
  const isDraymond = form.protocol === "draymond" && !isNew;
  const [serverChains, setServerChains] = useState([]);
  const [serverSchedules, setServerSchedules] = useState([]);
  const [chainsLoading, setChainsLoading] = useState(false);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [executingChain, setExecutingChain] = useState(null);
  const [togglingSchedule, setTogglingSchedule] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);

  /** Fetch chains and schedules from the server */
  const refreshDraymondData = useCallback(async () => {
    if (!draymondClient || draymondClient.status !== "connected") return;
    setChainsLoading(true);
    setSchedulesLoading(true);
    try {
      const chains = await draymondClient.listChains();
      setServerChains(Array.isArray(chains) ? chains : []);
    } catch (err) {
      console.error("[Settings] Failed to fetch chains:", err);
    } finally {
      setChainsLoading(false);
    }
    try {
      const schedules = await draymondClient.listSchedules();
      setServerSchedules(Array.isArray(schedules) ? schedules : []);
    } catch (err) {
      console.error("[Settings] Failed to fetch schedules:", err);
    } finally {
      setSchedulesLoading(false);
    }
  }, [draymondClient]);

  // Auto-fetch when entering settings for a connected Draymond bot
  useEffect(() => {
    if (isDraymond && draymondClient && draymondClient.status === "connected") {
      refreshDraymondData();
    }
  }, [isDraymond, draymondClient, refreshDraymondData]);

  /** Execute a chain by slug */
  const handleExecuteChain = async (chainSlug) => {
    if (!draymondClient || executingChain) return;
    setExecutingChain(chainSlug);
    try {
      await draymondClient.executeChain(chainSlug);
    } catch (err) {
      console.error("[Settings] Chain execution failed:", err);
    } finally {
      setExecutingChain(null);
    }
  };

  /** Toggle a schedule's enabled state */
  const handleToggleSchedule = async (jobName, currentEnabled) => {
    if (!draymondClient || togglingSchedule) return;
    setTogglingSchedule(jobName);
    try {
      await draymondClient.toggleSchedule(jobName, !currentEnabled);
      // Update local state optimistically
      setServerSchedules((prev) =>
        prev.map((s) =>
          s.job_name === jobName ? { ...s, enabled: !currentEnabled } : s
        )
      );
    } catch (err) {
      console.error("[Settings] Schedule toggle failed:", err);
    } finally {
      setTogglingSchedule(null);
    }
  };

  const inputStyle = {
    width: "100%",
    background: "#141924",
    border: "1px solid rgba(34,211,238,0.20)",
    borderRadius: 8,
    padding: "9px 12px",
    color: "#f0f0f5",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    marginTop: 4,
  };

  const labelStyle = {
    fontSize: 12,
    color: "#f6f7f9",
    display: "block",
    marginBottom: 2,
  };

  const isFullUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

  const getDraymondBaseUrl = (host, port) => {
    const normalizedHost = String(host || "127.0.0.1").trim();
    if (isFullUrl(normalizedHost)) {
      return normalizedHost.replace(/\/$/, "");
    }
    if (!isLocalhost(normalizedHost)) {
      return `https://${normalizedHost}`;
    }
    return `http://${normalizedHost}:${port || 8644}`;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0e1117",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "52px 16px 16px",
          borderBottom: "1px solid #1a1a26",
          background: "#0e1117",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: form.color || "#22d3ee",
            cursor: "pointer",
            display: "flex",
          }}
        >
          <BackIcon />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "#f6f7f9" }}>
            {isNew ? "New Bot" : `${bot.name} Settings`}
          </div>
          <div style={{ fontSize: 12, color: "#8b8b9e" }}>
            {form.protocol === "openclaw"
              ? "OpenClaw WebSocket"
              : form.protocol === "hermes"
              ? "Hermes HTTP"
              : form.protocol === "uplift-bridge"
              ? "Uplift Bridge API"
              : form.protocol === "subteam"
              ? "SubTeam / Draymond"
              : form.protocol === "draymond"
              ? "Draymond Orchestrator"
              : form.protocol === "ntfy"
              ? "ntfy (push)"
              : "Unknown Protocol"}
          </div>
        </div>
        {!isNew && isFieldVisible("deleteBot", mode) && (
          <button
            onClick={onDelete}
            style={{
              background: "none",
              border: "none",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: 13,
              padding: "4px 8px",
            }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Form */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {isNew && (
          <>
            <div>
              <span style={labelStyle}>Display Name</span>
              <input
                style={inputStyle}
                value={form.name}
                onChange={updateField("name")}
                placeholder="My Agent"
              />
            </div>
            <div>
              <span style={labelStyle}>Avatar Emoji</span>
              <input
                style={inputStyle}
                value={form.avatar}
                onChange={updateField("avatar")}
                placeholder="🤖"
              />
            </div>
            {isFieldVisible("protocol", mode) && (
              <div>
                <span style={labelStyle}>Protocol</span>
                <select
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={form.protocol}
                  onChange={updateField("protocol")}
                >
                  {availableProtocols.includes("hermes") && (
                    <option value="hermes">Hermes (HTTP / OpenAI-compatible)</option>
                  )}
                  {availableProtocols.includes("openclaw") && (
                    <option value="openclaw">OpenClaw (WebSocket)</option>
                  )}
                  {availableProtocols.includes("uplift-bridge") && (
                    <option value="uplift-bridge">Uplift Bridge (Uplift Agent)</option>
                  )}
                  {availableProtocols.includes("subteam") && (
                    <option value="subteam">SubTeam (CPU Design / Draymond)</option>
                  )}
                  {availableProtocols.includes("draymond") && (
                    <option value="draymond">Draymond Orchestrator (Multi-Agent)</option>
                  )}
                  {availableProtocols.includes("ntfy") && (
                    <option value="ntfy">ntfy (Push / Approvals)</option>
                  )}
                </select>
              </div>
            )}
            <div>
              <span style={labelStyle}>Accent Color</span>
              <input
                type="color"
                style={{ ...inputStyle, height: 40, padding: "4px 8px", cursor: "pointer" }}
                value={form.color}
                onChange={updateField("color")}
              />
            </div>
          </>
        )}

        {isFieldVisible("host", mode) && (
          <div>
            <span style={labelStyle}>
              {form.protocol === "draymond" ? "Host / Tunnel URL" : form.protocol === "ntfy" ? "ntfy Server" : "Host"}
            </span>
            <input
              style={inputStyle}
              value={form.host}
              onChange={updateField("host")}
              placeholder={
                form.protocol === "draymond"
                  ? "xxxx-xxxx.trycloudflare.com"
                  : form.protocol === "ntfy"
                  ? "https://ntfy.sh"
                  : "127.0.0.1"
              }
            />
            {/* Draymond is designed for remote access via Cloudflare tunnel */}
            {form.protocol === "draymond" && form.host && !isLocalhost(form.host) && (
              <div
                style={{
                  marginTop: 6,
                  padding: "6px 10px",
                  background: "#0a1f1a",
                  border: "1px solid #12715a",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#34d399",
                  lineHeight: 1.5,
                }}
              >
                Remote tunnel detected — Open-Chat will connect over HTTPS.
                Saved ports are ignored for remote tunnel hosts.
              </div>
            )}
            {/* Warn about remote hosts for local-only protocols */}
            {form.protocol !== "draymond" && form.protocol !== "ntfy" && form.host && !isLocalhost(form.host) && (
              <div
                style={{
                  marginTop: 6,
                  padding: "6px 10px",
                  background: "#2d1f0a",
                  border: "1px solid #7c4b12",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#f59e0b",
                  lineHeight: 1.5,
                }}
              >
                ⚠ Non-localhost host detected. Use <strong>127.0.0.1</strong> for
                security — remote hosts expose your agent to the network.
              </div>
            )}
          </div>
        )}

        {isFieldVisible("port", mode) && (
          <div>
            <span style={labelStyle}>Port</span>
            <input
              style={inputStyle}
              value={form.port}
              onChange={updateField("port")}
              placeholder={PROTOCOL_DEFAULT_PORTS[form.protocol] ?? ""}
            />
          </div>
        )}

        {isFieldVisible("token", mode) && (
          <div>
          <span style={labelStyle}>
            {form.protocol === "openclaw"
              ? "OPENCLAW_GATEWAY_TOKEN"
              : form.protocol === "uplift-bridge"
              ? "UPLIFT_OAUTH_TOKEN"
              : form.protocol === "ntfy"
              ? "NTFY_ACCESS_TOKEN (optional)"
              : "API_SERVER_KEY"}
          </span>
          <input
            style={inputStyle}
            value={form.token}
            onChange={updateField("token")}
            placeholder="Leave blank if none"
            type="password"
          />
          {form.token && (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: "#8b8b9e",
                fontFamily: "monospace",
              }}
            >
              Stored as: {maskToken(form.token)}
            </div>
          )}
        </div>
        )}

        {isFieldVisible("voiceEnabled", mode) && (
          <div>
            <span style={labelStyle}>Voice (push-to-talk + auto-speak)</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={form.voiceEnabled === true}
                onChange={(e) =>
                  updateField("voiceEnabled")({ target: { value: e.target.checked } })
                }
              />
              Enable voice for this bot
            </label>
          </div>
        )}

        {isFieldVisible("voiceBackend", mode) && (
          <div>
            <span style={labelStyle}>Voice backend</span>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={form.voiceBackend || "draymond"}
              onChange={updateField("voiceBackend")}
            >
              <option value="draymond">Draymond (standard gateway)</option>
              <option value="aetherdesk">AetherDesk (direct)</option>
            </select>
          </div>
        )}

        {isFieldVisible("aetherdeskApiKey", mode) && (
          <div>
            <span style={labelStyle}>AetherDesk API key (direct voice)</span>
            <input
              style={inputStyle}
              value={form.aetherdeskApiKey || ""}
              onChange={updateField("aetherdeskApiKey")}
              placeholder="x-api-key for AetherDesk direct backend"
              type="password"
            />
          </div>
        )}

        {form.protocol === "ntfy" && isFieldVisible("topic", mode) && (
          <div>
            <span style={labelStyle}>Topic</span>
            <input
              style={inputStyle}
              value={form.topic}
              onChange={updateField("topic")}
              placeholder="draymond-approvals"
            />
          </div>
        )}

        {isFieldVisible("connectionInfo", mode) && (
          <div
            style={{
            background: "#0e1117",
            borderRadius: 10,
            padding: "12px 14px",
          }}
          >
          <div
            style={{
              fontSize: 11,
              color: "#8b8b9e",
              lineHeight: 1.7,
              fontFamily: "monospace",
            }}
          >
            {form.protocol === "openclaw" ? (
              <>
                ws://{form.host || "127.0.0.1"}:{form.port || 18789}
                <br />→ role:operator · scope:chat · streams via event:agent
              </>
            ) : form.protocol === "uplift-bridge" ? (
              <>
                http://{form.host || "127.0.0.1"}:{form.port || 8642}
                /v1/environments/bridge
                <br />→ POST to register, polls /work/poll every 2 s
                <br />→ OAuth token required (UPLIFT_OAUTH_TOKEN)
              </>
            ) : form.protocol === "subteam" ? (
              <>
                http://{form.host || "127.0.0.1"}:{form.port || 8642}
                /v1/chat/completions
                <br />→ SubTeam / Draymond orchestrator · stream: true
                <br />→ 5-tool pipeline: spec → microarch → impl → verify → run
              </>
            ) : form.protocol === "draymond" ? (
              <>
                {getDraymondBaseUrl(form.host, form.port)}/api/v1/orchestrate
                <br />→ Multi-agent coordination · Agent discovery
                <br />→ Workflow tracking · Tool execution monitoring
                <br />→ Real-time SSE event stream
              </>
            ) : form.protocol === "ntfy" ? (
              <>
                {form.host || "https://ntfy.sh"}/{form.topic || "draymond-approvals"}
                <br />→ Subscribes via NDJSON stream /json
                <br />→ Renders Approve / Reject action buttons
                <br />→ Draymond approval relay (human-in-the-loop)
              </>
            ) : (
              <>
                http://{form.host || "127.0.0.1"}:{form.port || 8642}
                /v1/chat/completions
                <br />→ model: hermes-agent · stream: true
                <br />→ set API_SERVER_CORS_ORIGINS=* in .env
              </>
            )}
          </div>
        </div>
        )}

        {/* Phase 4 & 5 Developer Tools (Dev mode only) */}
        {!isNew && mode === MODES.DEV && (
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#f6f7f9",
                marginBottom: 10,
                marginTop: 10,
              }}
            >
              Developer Tools
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {isFieldVisible("toolLogs", mode) && onOpenAuditLog && (
                <button
                  onClick={onOpenAuditLog}
                  style={{
                    width: "100%",
                    background: "#141924",
                    border: "1px solid rgba(34,211,238,0.20)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#f0f0f5",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  📋 Audit Log & Tool Execution History
                </button>
              )}

              {isFieldVisible("toolExecutionConsole", mode) && onOpenToolConsole && (
                <button
                  onClick={onOpenToolConsole}
                  style={{
                    width: "100%",
                    background: "#141924",
                    border: "1px solid rgba(34,211,238,0.20)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#f0f0f5",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  🔧 Tool Execution Console
                </button>
              )}

              {isFieldVisible("developerPanel", mode) && onOpenDevPanel && (
                <button
                  onClick={onOpenDevPanel}
                  style={{
                    width: "100%",
                    background: "#141924",
                    border: "1px solid rgba(34,211,238,0.20)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#f0f0f5",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  💻 Developer Panel (Config, Logs, Models)
                </button>
              )}

              {isFieldVisible("automationScheduler", mode) && onOpenScheduler && (
                <button
                  onClick={onOpenScheduler}
                  style={{
                    width: "100%",
                    background: "#141924",
                    border: "1px solid rgba(34,211,238,0.20)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#f0f0f5",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  ⏰ Automation Scheduler
                </button>
              )}

              {isFieldVisible("teamManagement", mode) && onOpenTeamPanel && (
                <button
                  onClick={onOpenTeamPanel}
                  style={{
                    width: "100%",
                    background: "#141924",
                    border: "1px solid rgba(34,211,238,0.20)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#f0f0f5",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  👥 Team Management
                </button>
              )}
            </div>
          </div>
        )}

        {/* Draymond Remote Management (Draymond bots in Dev mode) */}
        {isDraymond && mode === MODES.DEV && (
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#f6f7f9",
                marginBottom: 10,
                marginTop: 10,
              }}
            >
              Draymond Remote
            </div>

            {/* Chain Management */}
            <div
              style={{
                background: "#0e1117",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f6f7f9" }}>
                  Chains / Pipelines
                </span>
                <button
                  onClick={refreshDraymondData}
                  disabled={chainsLoading}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#22d3ee",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: "2px 6px",
                  }}
                >
                  {chainsLoading ? "Loading…" : "Refresh"}
                </button>
              </div>

              {serverChains.length === 0 && !chainsLoading && (
                <div style={{ fontSize: 12, color: "#8b8b9e", padding: "4px 0" }}>
                  No chains found on server.
                </div>
              )}

              {serverChains.map((chain) => (
                <div
                  key={chain.slug || chain.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderTop: "1px solid #2a2a38",
                  }}
                >
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#f0f0f5",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {chain.name || chain.slug}
                    </div>
                    {chain.description && (
                      <div style={{ fontSize: 11, color: "#8b8b9e", marginTop: 2 }}>
                        {chain.description}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleExecuteChain(chain.slug)}
                    disabled={executingChain === chain.slug}
                    style={{
                      background: executingChain === chain.slug ? "#333" : "#1e3a2f",
                      border: "1px solid #34d39940",
                      borderRadius: 6,
                      padding: "4px 10px",
                      color: "#34d399",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: executingChain === chain.slug ? "default" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {executingChain === chain.slug ? "Running…" : "Run"}
                  </button>
                </div>
              ))}
            </div>

            {/* Schedule Management */}
            <div
              style={{
                background: "#0e1117",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f6f7f9" }}>
                  Scheduled Jobs
                </span>
                <button
                  onClick={refreshDraymondData}
                  disabled={schedulesLoading}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#22d3ee",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: "2px 6px",
                  }}
                >
                  {schedulesLoading ? "Loading…" : "Refresh"}
                </button>
              </div>

              {serverSchedules.length === 0 && !schedulesLoading && (
                <div style={{ fontSize: 12, color: "#8b8b9e", padding: "4px 0" }}>
                  No schedules found on server.
                </div>
              )}

              {serverSchedules.map((sched) => (
                <div
                  key={sched.job_name || sched.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderTop: "1px solid #2a2a38",
                  }}
                >
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#f0f0f5",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {sched.job_name || sched.name}
                    </div>
                    {sched.cron && (
                      <div style={{ fontSize: 11, color: "#8b8b9e", marginTop: 2, fontFamily: "monospace" }}>
                        {sched.cron}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      handleToggleSchedule(
                        sched.job_name || sched.name,
                        sched.enabled !== false
                      )
                    }
                    disabled={togglingSchedule === (sched.job_name || sched.name)}
                    style={{
                      background:
                        sched.enabled !== false ? "#1e3a2f" : "#2d1f1f",
                      border: `1px solid ${sched.enabled !== false ? "#34d39940" : "#ef444440"}`,
                      borderRadius: 6,
                      padding: "4px 10px",
                      color: sched.enabled !== false ? "#34d399" : "#ef4444",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: togglingSchedule === (sched.job_name || sched.name) ? "default" : "pointer",
                      flexShrink: 0,
                      minWidth: 50,
                      textAlign: "center",
                    }}
                  >
                    {sched.enabled !== false ? "On" : "Off"}
                  </button>
                </div>
              ))}
            </div>

            {/* Notification History */}
            <div
              style={{
                background: "#0e1117",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <button
                onClick={() => setShowNotifications((prev) => !prev)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f6f7f9" }}>
                  Recent Notifications ({draymondNotifications.length})
                </span>
                <span style={{ fontSize: 11, color: "#8b8b9e" }}>
                  {showNotifications ? "Hide" : "Show"}
                </span>
              </button>

              {showNotifications && (
                <div style={{ marginTop: 8 }}>
                  {draymondNotifications.length === 0 && (
                    <div style={{ fontSize: 12, color: "#8b8b9e", padding: "4px 0" }}>
                      No notifications received yet.
                    </div>
                  )}
                  {draymondNotifications.slice(-10).reverse().map((notif, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "6px 0",
                        borderTop: i > 0 ? "1px solid #2a2a38" : "none",
                        fontSize: 12,
                        color: "#f6f7f9",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background:
                              notif.type === "notification_failed" ? "#ef4444" : "#34d399",
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {notif.subject || notif.type || "Notification"}
                        </span>
                        <span style={{ fontSize: 10, color: "#8b8b9e", flexShrink: 0 }}>
                          {notif.receivedAt ? new Date(notif.receivedAt).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      {notif.recipient && (
                        <div style={{ fontSize: 10, color: "#8b8b9e", marginTop: 2, marginLeft: 12 }}>
                          To: {notif.recipient}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div style={{ padding: "12px 20px 32px", borderTop: "1px solid #1a1a26" }}>
        <button
          onClick={() => onSave(form)}
          disabled={isNew && !form.name.trim()}
          style={{
            width: "100%",
            background:
              isNew && !form.name.trim() ? "#333" : form.color || "#22d3ee",
            color: "#0d0d14",
            border: "none",
            borderRadius: 12,
            padding: "13px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            opacity: isNew && !form.name.trim() ? 0.5 : 1,
          }}
        >
          {isNew ? "Create Bot" : "Save & Reconnect"}
        </button>
      </div>
    </div>
  );
}

Settings.propTypes = {
  bot: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    avatar: PropTypes.string,
    color: PropTypes.string,
    tagline: PropTypes.string,
    protocol: PropTypes.string,
    host: PropTypes.string,
    port: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    token: PropTypes.string,
    topic: PropTypes.string,
  }).isRequired,
  isNew: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  onBack: PropTypes.func.isRequired,
  mode: PropTypes.string.isRequired,
  onOpenAuditLog: PropTypes.func,
  onOpenToolConsole: PropTypes.func,
  onOpenDevPanel: PropTypes.func,
  onOpenTeamPanel: PropTypes.func,
  onOpenScheduler: PropTypes.func,
  draymondClient: PropTypes.object,
  draymondNotifications: PropTypes.array,
};
