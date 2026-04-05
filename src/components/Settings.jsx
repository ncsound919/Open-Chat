import React, { useState } from "react";
import { BackIcon } from "./icons/Icons.jsx";
import { isLocalhost, maskToken } from "../utils/security.js";

/**
 * Settings panel for bot configuration
 * Supports both editing existing bots and creating new ones
 */
export function Settings({ bot, isNew, onSave, onDelete, onBack }) {
  const [form, setForm] = useState({ ...bot });

  const updateField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

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
              : "Unknown Protocol"}
          </div>
        </div>
        {!isNew && (
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
            <div>
              <span style={labelStyle}>Protocol</span>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.protocol}
                onChange={updateField("protocol")}
              >
                <option value="hermes">Hermes (HTTP / OpenAI-compatible)</option>
                <option value="openclaw">OpenClaw (WebSocket)</option>
                <option value="uplift-bridge">Uplift Bridge (Uplift Agent)</option>
                <option value="subteam">SubTeam (CPU Design / Draymond)</option>
              </select>
            </div>
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

        <div>
          <span style={labelStyle}>Port</span>
          <input
            style={inputStyle}
            value={form.port}
            onChange={updateField("port")}
            placeholder={form.protocol === "openclaw" ? "18789" : "8642"}
          />
        </div>

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
