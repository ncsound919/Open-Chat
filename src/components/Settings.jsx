import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { BackIcon } from "./icons/Icons.jsx";
import { isLocalhost, maskToken } from "../utils/security.js";
import { isFieldVisible, getAvailableProtocols, getModeDefaults, MODES } from "../utils/modeConfig.js";

const PROTOCOL_DEFAULT_PORTS = {
  openclaw: "18789",
  hermes: "8642",
  "uplift-bridge": "8642",
  draymond: "8644",
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

  const inputStyle = {
    width: "100%",
    background: "#1c1c28",
    border: "1px solid #2a2a38",
    borderRadius: 8,
    padding: "9px 12px",
    color: "#e8e8f0",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    marginTop: 4,
  };

  const labelStyle = {
    fontSize: 12,
    color: "#666680",
    display: "block",
    marginBottom: 2,
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
          padding: "52px 16px 16px",
          borderBottom: "1px solid #1a1a26",
          background: "#111118",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: form.color || "#818cf8",
            cursor: "pointer",
            display: "flex",
          }}
        >
          <BackIcon />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "#f0f0f5" }}>
            {isNew ? "New Bot" : `${bot.name} Settings`}
          </div>
          <div style={{ fontSize: 12, color: "#444455" }}>
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
            <span style={labelStyle}>Host</span>
            <input
              style={inputStyle}
              value={form.host}
              onChange={updateField("host")}
              placeholder="127.0.0.1"
            />
            {form.host && !isLocalhost(form.host) && (
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
                ⚠️ Non-localhost host detected. Use <strong>127.0.0.1</strong> for
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
                color: "#555568",
                fontFamily: "monospace",
              }}
            >
              Stored as: {maskToken(form.token)}
            </div>
          )}
        </div>
        )}

        {isFieldVisible("connectionInfo", mode) && (
          <div
            style={{
              background: "#1a1a26",
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
          <div
            style={{
              fontSize: 11,
              color: "#555568",
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
                http://{form.host || "127.0.0.1"}:{form.port || 8644}
                /v1/orchestrate
                <br />→ Multi-agent coordination · Agent discovery
                <br />→ Workflow tracking · Tool execution monitoring
                <br />→ Real-time SSE event stream
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
                color: "#e8e8f0",
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
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#e8e8f0",
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
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#e8e8f0",
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
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#e8e8f0",
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
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#e8e8f0",
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
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#e8e8f0",
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
      </div>

      {/* Save Button */}
      <div style={{ padding: "12px 20px 32px", borderTop: "1px solid #1a1a26" }}>
        <button
          onClick={() => onSave(form)}
          disabled={isNew && !form.name.trim()}
          style={{
            width: "100%",
            background:
              isNew && !form.name.trim() ? "#333" : form.color || "#818cf8",
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
};
