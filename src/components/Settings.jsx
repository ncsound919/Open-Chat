import React, { useState, useMemo, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { BackIcon } from "./icons/Icons.jsx";
import { BotAvatar } from "./BotAvatar.jsx";
import { isLocalhost, maskToken } from "../utils/security.js";
import { isFieldVisible, getAvailableProtocols, getModeDefaults, MODES } from "../utils/modeConfig.js";
import { scanLocalModels, modelServerToBot } from "../utils/localModels.js";
import * as secureStore from "../utils/secureStore.js";

const PROTOCOL_DEFAULT_PORTS = {
  openclaw: "18789",
  hermes: "8642",
  "uplift-bridge": "8642",
  draymond: "3444",
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
  draymondAgents = {},
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

  // ── Connection test state ─────────────────────────────────────────────────
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState(null); // { ok, message }

  // ── Local security (at-rest encryption) state ─────────────────────────────
  const [secNewPass, setSecNewPass] = useState("");
  const [secConfirmPass, setSecConfirmPass] = useState("");
  const [secCurrPass, setSecCurrPass] = useState("");
  const [secNew2, setSecNew2] = useState("");
  const [secConfirm2, setSecConfirm2] = useState("");
  const [secMsg, setSecMsg] = useState("");
  const [secErr, setSecErr] = useState("");
  const [secBusy, setSecBusy] = useState(false);

  const handleEnableEncryption = async () => {
    setSecErr(""); setSecMsg("");
    if (secNewPass !== secConfirmPass) {
      setSecErr("Passphrases do not match.");
      return;
    }
    setSecBusy(true);
    try {
      await secureStore.enable(secNewPass);
      setSecNewPass(""); setSecConfirmPass("");
      setSecMsg("Encryption enabled — history and bot tokens are now encrypted at rest.");
    } catch (e) {
      setSecErr(e?.message || "Could not enable encryption.");
    } finally {
      setSecBusy(false);
    }
  };

  const handleChangePassphrase = async () => {
    setSecErr(""); setSecMsg("");
    if (secNew2 !== secConfirm2) {
      setSecErr("New passphrases do not match.");
      return;
    }
    setSecBusy(true);
    try {
      // Verify the current passphrase by a lock/unlock round-trip, then re-encrypt.
      await secureStore.unlock(secCurrPass);
      await secureStore.change(secCurrPass, secNew2);
      setSecCurrPass(""); setSecNew2(""); setSecConfirm2("");
      setSecMsg("Passphrase changed.");
    } catch {
      setSecErr("Current passphrase is incorrect.");
    } finally {
      setSecBusy(false);
    }
  };

  const handleLockNow = () => {
    secureStore.lock();
    window.location.reload();
  };

  /** Test the Draymond connection: health + authenticated agent discovery. */
  const handleTestConnection = useCallback(async () => {
    if (!draymondClient) return;
    setTestingConn(true);
    setConnResult(null);
    try {
      const server = await draymondClient.getServerStatus();
      const health = await fetch(
        `${draymondClient.baseUrl}/v1/health`,
        { headers: draymondClient.token ? { Authorization: `Bearer ${draymondClient.token}` } : {} }
      ).then((r) => r.ok);
      if (!health) {
        setConnResult({ ok: false, message: "Health check failed — is Draymond running and reachable?" });
        return;
      }
      const agents = await draymondClient._discoverAgents();
      const count = Object.keys(agents || {}).length;
      setConnResult({
        ok: count > 0,
        message: count > 0
          ? `Connected — ${count} agents discovered${server?.status ? ` (${server.status})` : ""}.`
          : "Health OK but no agents discovered (auth may be wrong).",
      });
    } catch (err) {
      setConnResult({ ok: false, message: `Connection failed: ${err?.message || err}` });
    } finally {
      setTestingConn(false);
    }
  }, [draymondClient]);

  // ── Local model scanning state ────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);
  const [scanError, setScanError] = useState(null);
  const [expandedServer, setExpandedServer] = useState(null);
  const [lanHost, setLanHost] = useState("");

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setScanResults([]);
    try {
      const results = await detectLocalModels({ extraHost: lanHost });
      setScanResults(results);
      if (results.length === 0) {
        setScanError("No local models found. Open the Chat screen on your phone or enable experimental scans in Draymond settings, then scan again.");
      }
    } catch (err) {
      setScanError(`Scan failed: ${err?.message || err}`);
    } finally {
      setScanning(false);
    }
  }, [lanHost]);

  const handleUseModel = async (server, modelId) => {
    const bot = modelServerToBot(server, modelId);
    // Keep the current form's identity if this is a new-bot creation flow
    const merged = isNew ? { ...form, ...bot } : bot;
    onSave(merged);
  };

  /** Fetch chains and schedules from the server */
  const refreshDraymondData = useCallback(async () => {
    if (!draymondClient || draymondClient.status !== "connected") return;
    setChainsLoading(true);
    setSchedulesLoading(true);
    try {
      const chains = await draymondClient.listChains();
      setServerChains(chains?.chains || []);
    } catch (err) {
      console.error("[Settings] Failed to fetch chains:", err);
    } finally {
      setChainsLoading(false);
    }
    try {
      const schedules = await draymondClient.listSchedules();
      setServerSchedules(schedules?.schedules || []);
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
      await draymondClient.toggleSchedule(
        jobName,
        currentEnabled ? "disable" : "enable"
      );
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

  /** Origin (scheme://host:port) of the connected Draymond server. */
  const getDraymondOrigin = (client) => {
    if (!client?.baseUrl) return "";
    return client.baseUrl.replace(/\/api\/?$/, "");
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
              : form.protocol === "local"
              ? "Private Local · On-device"
              : form.protocol === "a2a"
              ? "A2A · Agent2Agent"
              : form.protocol === "mcp"
              ? "MCP Host"
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
                  {availableProtocols.includes("local") && (
                    <option value="local">Private Local (On-device)</option>
                  )}
                  {availableProtocols.includes("a2a") && (
                    <option value="a2a">A2A (Agent2Agent)</option>
                  )}
                  {availableProtocols.includes("mcp") && (
                    <option value="mcp">MCP Host (Tools)</option>
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

        {form.protocol !== "local" && form.protocol !== "a2a" && form.protocol !== "mcp" && isFieldVisible("host", mode) && (
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

        {form.protocol !== "local" && form.protocol !== "a2a" && form.protocol !== "mcp" && isFieldVisible("port", mode) && (
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

        {form.protocol !== "local" && form.protocol !== "mcp" && isFieldVisible("token", mode) && (
          <div>
          <span style={labelStyle}>
            {form.protocol === "openclaw"
              ? "OPENCLAW_GATEWAY_TOKEN"
              : form.protocol === "uplift-bridge"
              ? "UPLIFT_OAUTH_TOKEN"
              : form.protocol === "ntfy"
              ? "NTFY_ACCESS_TOKEN (optional)"
              : form.protocol === "a2a"
              ? "API Key (optional)"
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

        {/* A2A (Agent2Agent) Agent Card URL */}
        {form.protocol === "a2a" && (
          <div>
            <span style={labelStyle}>Agent Card URL</span>
            <input
              style={inputStyle}
              value={form.agentCardUrl || ""}
              onChange={updateField("agentCardUrl")}
              placeholder="https://agent.example.com"
            />
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
              A2A discovers remote agents via their Agent Card (skills,
              capabilities, interfaces). Open-Chat then delegates tasks and
              streams responses.
            </div>
          </div>
        )}

        {/* MCP Host server list */}
        {form.protocol === "mcp" && (
          <div>
            <span style={labelStyle}>MCP Servers (JSON array)</span>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 80,
                fontFamily: "monospace",
                fontSize: 12,
              }}
              value={form.mcpServers || ""}
              onChange={updateField("mcpServers")}
              placeholder='[{"name":"local","url":"http://127.0.0.1:8000"}]'
            />
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
              Open-Chat acts as an MCP host, aggregating tools from these
              servers for its agents and the tool console.
            </div>
          </div>
        )}

        {/* Private Local model config */}
        {form.protocol === "local" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <span style={labelStyle}>Model</span>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.model || "auto"}
                onChange={updateField("model")}
              >
                <option value="auto">Auto (best available)</option>
                <option value="gemma_e4b">Gemma 3n E4B (flagship)</option>
                <option value="gemma_e2b">Gemma 3n E2B (fast)</option>
                <option value="nano">Gemini Nano</option>
                <option value="webllm">WebLLM (WebGPU)</option>
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.phoneToolsEnabled !== false}
                onChange={(e) =>
                  updateField("phoneToolsEnabled")({ target: { value: e.target.checked } })
                }
              />
              <span style={{ fontSize: 13, color: "#e0e0ea" }}>
                Allow phone control (tap, type, open apps)
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.galaxySkillsEnabled !== false}
                onChange={(e) =>
                  updateField("galaxySkillsEnabled")({ target: { value: e.target.checked } })
                }
              />
              <span style={{ fontSize: 13, color: "#e0e0ea" }}>
                Allow Galaxy AI skills (Samsung app AI)
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.draymondSkillsEnabled === true}
                onChange={(e) =>
                  updateField("draymondSkillsEnabled")({ target: { value: e.target.checked } })
                }
              />
              <span style={{ fontSize: 13, color: "#e0e0ea" }}>
                Allow Draymond skills (list / run / chains / enqueue)
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.verifyEnabled === true}
                onChange={(e) =>
                  updateField("verifyEnabled")({ target: { value: e.target.checked } })
                }
              />
              <span style={{ fontSize: 13, color: "#e0e0ea" }}>
                Verify replies (Gemini Nano cross-check)
              </span>
            </label>
            <div style={{ fontSize: 12, color: "#8b8b9e", lineHeight: 1.5 }}>
              Chat runs fully on-device. Download models and enable the
              accessibility service under Models.
            </div>
          </div>
        )}

        {/* Avatar image URL (e.g. a Draymond agent portrait) */}
        <div>
          <span style={labelStyle}>Avatar image URL (optional)</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <BotAvatar bot={form} size={40} />
            <input
              style={{ ...inputStyle, marginTop: 0 }}
              value={form.avatarUrl || ""}
              onChange={updateField("avatarUrl")}
              placeholder="https://host/avatars/slug.png or /avatars/slug.png"
            />
          </div>
          {form.avatarUrl && /^\/avatars\//.test(form.avatarUrl) && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#8b8b9e" }}>
              Relative paths resolve against the Draymond server origin.
            </div>
          )}
        </div>

        {/* Draymond connection test */}
        {isDraymond && (
          <div>
            <button
              onClick={handleTestConnection}
              disabled={testingConn}
              style={{
                width: "100%",
                background: connResult?.ok ? "#1e3a2f" : connResult ? "#2d1f1f" : "#141924",
                border: `1px solid ${connResult?.ok ? "#34d39980" : connResult ? "#ef444480" : "rgba(34,211,238,0.20)"}`,
                borderRadius: 8,
                padding: "10px 12px",
                color: connResult?.ok ? "#34d399" : connResult ? "#ef4444" : "#f0f0f5",
                fontSize: 13,
                cursor: testingConn ? "default" : "pointer",
              }}
            >
              {testingConn ? "Testing connection…" : connResult ? `↻ Test again — ${connResult.message}` : "Test connection"}
            </button>
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

            {/* Agent Roster */}
            {draymondAgents && Object.keys(draymondAgents).length > 0 && (
              <div
                style={{
                  background: "#0e1117",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f6f7f9", marginBottom: 8 }}>
                  Agent Roster ({Object.keys(draymondAgents).length})
                </div>
                {Object.values(draymondAgents).map((agent) => {
                  const avatarUrl =
                    agent.avatarUrl &&
                    (agent.avatarUrl.startsWith("http")
                      ? agent.avatarUrl
                      : `${getDraymondOrigin(draymondClient)}${agent.avatarUrl}`);
                  return (
                    <div
                      key={agent.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "6px 0",
                        borderTop: "1px solid #2a2a38",
                      }}
                    >
                      <BotAvatar bot={{ name: agent.name, avatarUrl, color: "#22d3ee" }} size={34} />
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
                          {agent.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#8b8b9e" }}>
                          {agent.status || "unknown"}
                          {agent.capabilities?.length ? ` · ${agent.capabilities.slice(0, 3).join(", ")}` : ""}
                        </div>
                      </div>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background:
                            agent.status === "online" || agent.status === "active"
                              ? "#34d399"
                              : agent.status === "degraded"
                              ? "#f59e0b"
                              : agent.status === "offline"
                              ? "#ef4444"
                              : "#6b7280",
                          flexShrink: 0,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

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

      {/* Local Model Discovery */}
      <div style={{ padding: "0 20px 24px" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#f6f7f9",
            marginBottom: 10,
            marginTop: 10,
          }}
        >
          Local Models
        </div>
        <div style={{ fontSize: 12, color: "#8b8b9e", marginBottom: 10, lineHeight: 1.5 }}>
          Scan this device (and optionally a LAN host) for OpenAI-compatible local
          model servers — Ollama, LM Studio, llama.cpp, MLC, KoboldCpp, vLLM, Jan, GPT4All.
          Detected models can be added as chat bots instantly.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            style={{ ...inputStyle, marginTop: 0, flex: 1 }}
            value={lanHost}
            onChange={(e) => setLanHost(e.target.value)}
            placeholder="LAN host (optional, e.g. 192.168.1.50)"
          />
          <button
            onClick={handleScan}
            disabled={scanning}
            style={{
              background: "#1e3a2f",
              border: "1px solid #34d39980",
              borderRadius: 8,
              padding: "10px 16px",
              color: "#34d399",
              fontSize: 13,
              fontWeight: 600,
              cursor: scanning ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>

        {scanError && (
          <div
            style={{
              background: "#2d1f1f",
              border: "1px solid #ef444440",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 12,
              color: "#ef4444",
              marginBottom: 10,
            }}
          >
            {scanError}
          </div>
        )}

        {scanResults.map((server) => {
          const expanded = expandedServer === server.baseUrl;
          return (
            <div
              key={server.baseUrl}
              style={{
                background: "#0e1117",
                border: "1px solid #2a2a38",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 8,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                onClick={() => setExpandedServer(expanded ? null : server.baseUrl)}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f5" }}>{server.name}</div>
                  <div style={{ fontSize: 11, color: "#8b8b9e", fontFamily: "monospace" }}>
                    {server.baseUrl} · {server.models.length} model{server.models.length === 1 ? "" : "s"}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: "#22d3ee" }}>{expanded ? "−" : "+"}</span>
              </div>

              {expanded && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {server.models.map((modelId) => (
                    <div
                      key={modelId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "6px 0",
                        borderTop: "1px solid #2a2a38",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#f0f0f5", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {modelId}
                      </span>
                      <button
                        onClick={() => handleUseModel(server, modelId)}
                        style={{
                          background: "#818cf8",
                          border: "none",
                          borderRadius: 6,
                          padding: "4px 12px",
                          color: "#0d0d14",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Local security (at-rest encryption) */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#f6f7f9",
          marginBottom: 10,
          marginTop: 10,
        }}
      >
        Security
      </div>

      {!secureStore.isSupported() ? (
        <div style={{ fontSize: 12, color: "#8b8b9e", lineHeight: 1.5 }}>
          At-rest encryption is not available in this context (requires WebCrypto
          in a secure context, e.g. the installed app or HTTPS).
        </div>
      ) : !secureStore.isEnabled() ? (
        <div
          style={{
            background: "#0e1117",
            border: "1px solid #2a2a38",
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 12, color: "#8b8b9e", lineHeight: 1.5, marginBottom: 10 }}>
            Encrypt chat history and bot tokens (access keys) at rest. You will
            unlock with this passphrase every time the app opens.
          </div>
          <input
            type="password"
            style={{ ...inputStyle, marginTop: 0 }}
            value={secNewPass}
            onChange={(e) => setSecNewPass(e.target.value)}
            placeholder="New passphrase"
            aria-label="New passphrase"
          />
          <input
            type="password"
            style={inputStyle}
            value={secConfirmPass}
            onChange={(e) => setSecConfirmPass(e.target.value)}
            placeholder="Confirm passphrase"
            aria-label="Confirm passphrase"
          />
          <button
            onClick={handleEnableEncryption}
            disabled={secBusy || !secNewPass || !secConfirmPass}
            style={{
              width: "100%",
              marginTop: 10,
              background: "#22d3ee",
              border: "none",
              borderRadius: 8,
              padding: "10px",
              color: "#05060a",
              fontSize: 13,
              fontWeight: 700,
              cursor: secBusy ? "default" : "pointer",
              opacity: secBusy || !secNewPass || !secConfirmPass ? 0.6 : 1,
            }}
          >
            {secBusy ? "Encrypting…" : "Enable encryption"}
          </button>
        </div>
      ) : (
        <div
          style={{
            background: "#0e1117",
            border: "1px solid #34d39940",
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#34d399" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399" }} />
            Local data encrypted
          </div>

          <div style={{ fontSize: 11, color: "#8b8b9e", margin: "10px 0 8px" }}>Change passphrase</div>
          <input
            type="password"
            style={{ ...inputStyle, marginTop: 0 }}
            value={secCurrPass}
            onChange={(e) => setSecCurrPass(e.target.value)}
            placeholder="Current passphrase"
            aria-label="Current passphrase"
          />
          <input
            type="password"
            style={inputStyle}
            value={secNew2}
            onChange={(e) => setSecNew2(e.target.value)}
            placeholder="New passphrase"
            aria-label="New passphrase (change)"
          />
          <input
            type="password"
            style={inputStyle}
            value={secConfirm2}
            onChange={(e) => setSecConfirm2(e.target.value)}
            placeholder="Confirm new passphrase"
            aria-label="Confirm new passphrase"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={handleChangePassphrase}
              disabled={secBusy || !secCurrPass || !secNew2 || !secConfirm2}
              style={{
                flex: 1,
                background: "#818cf8",
                border: "none",
                borderRadius: 8,
                padding: "10px",
                color: "#0d0d14",
                fontSize: 13,
                fontWeight: 700,
                cursor: secBusy ? "default" : "pointer",
                opacity: secBusy || !secCurrPass || !secNew2 || !secConfirm2 ? 0.6 : 1,
              }}
            >
              {secBusy ? "Working…" : "Change"}
            </button>
            <button
              onClick={handleLockNow}
              style={{
                flex: 1,
                background: "#2d1f1f",
                border: "1px solid #ef444440",
                borderRadius: 8,
                padding: "10px",
                color: "#ef4444",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Lock now
            </button>
          </div>
        </div>
      )}

      {secMsg && (
        <div
          role="status"
          style={{
            fontSize: 12,
            color: "#34d399",
            background: "#34d39918",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          {secMsg}
        </div>
      )}
      {secErr && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "#ef4444",
            background: "#ef444418",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          {secErr}
        </div>
      )}

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
  draymondAgents: PropTypes.object,
};
