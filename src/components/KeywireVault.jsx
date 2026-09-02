import React, { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { KeywireClient, KEYWIRE_DEFAULT_BASE } from "../utils/keywireClient.js";
import { maskToken } from "../utils/security.js";

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0e1117",
  border: "1px solid #2a2a38",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#f0f0f5",
  fontSize: 13,
  outline: "none",
};

const labelStyle = { display: "block", fontSize: 12, color: "#8b8b9e", marginBottom: 6 };

const btn = (bg, fg, border) => ({
  background: bg,
  border: border || "none",
  borderRadius: 8,
  padding: "8px 14px",
  color: fg,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
});

const card = { background: "#12141d", border: "1px solid #2a2a38", borderRadius: 10, padding: "12px 14px", marginBottom: 12 };

/**
 * KeywireVault — the Keywire zero-trust vault connection + secret browser for
 * the Settings screen. Configure the vault host/token once here, verify the
 * connection, pick a default project/environment, and browse (masked) secrets.
 */
export function KeywireVault({ config, onSaveConfig }) {
  const cfg = {
    baseUrl: config?.baseUrl || "",
    token: config?.token || "",
    projectId: config?.projectId || "",
    envSlug: config?.envSlug || "",
  };
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl);
  const [token, setToken] = useState(cfg.token);
  const [dirty, setDirty] = useState(false);

  const [status, setStatus] = useState(null); // { kind: 'ok'|'error', text }
  const [testing, setTesting] = useState(false);
  const [projects, setProjects] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [secrets, setSecrets] = useState([]);
  const [projectId, setProjectId] = useState(cfg.projectId);
  const [envSlug, setEnvSlug] = useState(cfg.envSlug);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [masked, setMasked] = useState(true);

  // Keep the component in sync when App pushes a fresh persisted config.
  useEffect(() => {
    setBaseUrl(cfg.baseUrl);
    setToken(cfg.token);
    setProjectId(cfg.projectId);
    setEnvSlug(cfg.envSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.token, config?.projectId, config?.envSlug]);

  const save = useCallback(
    (next) => {
      onSaveConfig?.(next);
      setDirty(false);
    },
    [onSaveConfig]
  );

  const persistEdits = useCallback(() => {
    save({ baseUrl: baseUrl.trim(), token: token.trim(), projectId, envSlug });
  }, [baseUrl, token, projectId, envSlug, save]);

  const client = () => {
    try {
      return new KeywireClient(baseUrl.trim() || KEYWIRE_DEFAULT_BASE, token.trim());
    } catch {
      return null;
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    const c = client();
    if (!c) {
      setStatus({ kind: "error", text: "Invalid vault URL — must use http(s)." });
      setTesting(false);
      return;
    }
    const res = await c.healthCheck();
    setStatus(
      res.ok
        ? { kind: "ok", text: "Keywire reachable." }
        : { kind: "error", text: res.error || "Keywire unreachable." }
    );
    if (res.ok) await loadProjects(c);
    setTesting(false);
  };

  const loadProjects = async (c) => {
    const res = await c.listProjects();
    setProjects(res.ok ? res.projects : []);
    if (!res.ok && res.auth) {
      setStatus({ kind: "error", text: "Vault reachable but the token is missing or invalid." });
    }
  };

  // Refresh the project list whenever connectivity could have changed.
  useEffect(() => {
    if (!dirty && (cfg.baseUrl || cfg.token)) {
      const c = client();
      if (c) loadProjects(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProject = async (id) => {
    setProjectId(id);
    setEnvSlug("");
    setSecrets([]);
    setDirty(true);
    const c = client();
    if (!c || !id) return;
    const res = await c.listEnvironments(id);
    setEnvironments(res.ok ? res.environments : []);
  };

  const handleEnv = async (slug) => {
    setEnvSlug(slug);
    setSecrets([]);
    setDirty(true);
    if (!slug) return;
    const c = client();
    if (!c || !projectId) return;
    setLoadingSecrets(true);
    setStatus(null);
    const res = await c.listSecrets(projectId, slug, { unmask: !masked });
    if (res.ok) setSecrets(res.secrets);
    else setStatus({ kind: "error", text: res.error || "Could not list secrets." });
    setLoadingSecrets(false);
  };

  const toggleMasked = async () => {
    const next = !masked;
    setMasked(next);
    if (projectId && envSlug) {
      const c = client();
      if (c) {
        setLoadingSecrets(true);
        const res = await c.listSecrets(projectId, envSlug, { unmask: !next });
        if (res.ok) setSecrets(res.secrets);
        setLoadingSecrets(false);
      }
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#f6f7f9", marginBottom: 10 }}>
        Keywire Vault
      </div>
      <div style={{ fontSize: 12, color: "#8b8b9e", marginBottom: 10, lineHeight: 1.5 }}>
        Zero-trust secret store for the fleet. Configure the connection so bot tokens and
        agent credentials can be resolved from the vault instead of local settings.
      </div>

      <div style={card}>
        <div style={{ marginBottom: 10 }}>
          <span style={labelStyle}>Vault URL</span>
          <input
            style={inputStyle}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setDirty(true);
            }}
            placeholder={KEYWIRE_DEFAULT_BASE}
            aria-label="Keywire vault URL"
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <span style={labelStyle}>Vault token (JWT / service token)</span>
          <input
            style={inputStyle}
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setDirty(true);
            }}
            placeholder="Paste a vault token"
            aria-label="Keywire vault token"
          />
          {token && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#8b8b9e", fontFamily: "monospace" }}>
              Token set: {maskToken(token)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn("#1e3a2f", "#34d399", "1px solid #34d39980")} onClick={handleTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            style={btn("#22d3ee", "#05060a")}
            onClick={persistEdits}
            disabled={!dirty}
          >
            Save vault config
          </button>
        </div>
        {status && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 12,
              background: status.kind === "ok" ? "#0a1f1a" : "#2d1f1f",
              border: status.kind === "ok" ? "1px solid #12715a" : "1px solid #ef444440",
              color: status.kind === "ok" ? "#34d399" : "#ef4444",
            }}
          >
            {status.text}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ marginBottom: 10 }}>
          <span style={labelStyle}>Default project (used by bot token resolution)</span>
          <select
            style={{ ...inputStyle, cursor: "pointer" }}
            value={projectId}
            onChange={(e) => handleProject(e.target.value)}
            aria-label="Vault project"
          >
            <option value="">— select project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.slug || p.id}
              </option>
            ))}
          </select>
        </div>
        {projectId && (
          <div style={{ marginBottom: 10 }}>
            <span style={labelStyle}>Environment</span>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={envSlug}
              onChange={(e) => handleEnv(e.target.value)}
              aria-label="Vault environment"
            >
              <option value="">— select environment —</option>
              {environments.map((e) => (
                <option key={e.id} value={e.slug}>
                  {e.name || e.slug}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#8b8b9e" }}>
            {loadingSecrets ? "Loading…" : `${secrets.length} secret${secrets.length === 1 ? "" : "s"}`}
          </div>
          <button
            style={{ ...btn("#1c1c28", masked ? "#888" : "#f5c451", "1px solid #2c2c38") }}
            onClick={toggleMasked}
            disabled={!envSlug}
            title={masked ? "Reveal values (requires vault policy)" : "Hide values"}
          >
            {masked ? "Reveal" : "Hide"}
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          {secrets.map((s) => (
            <div
              key={`${s.environmentId || projectId}-${s.key}`}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                background: "#0e1117", border: "1px solid #1f1f2c", borderRadius: 8,
                padding: "7px 10px", marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 12, color: "#c8c9d4", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.key}
              </span>
              <span style={{ fontSize: 11, color: "#666679", fontFamily: "monospace", flexShrink: 0 }}>
                {typeof s.value === "string" && s.value ? s.value : "—"}
              </span>
            </div>
          ))}
          {envSlug && !loadingSecrets && secrets.length === 0 && (
            <div style={{ fontSize: 12, color: "#8b8b9e" }}>No secrets in this environment.</div>
          )}
        </div>
      </div>
    </div>
  );
}

KeywireVault.propTypes = {
  config: PropTypes.shape({
    baseUrl: PropTypes.string,
    token: PropTypes.string,
    projectId: PropTypes.string,
    envSlug: PropTypes.string,
  }),
  onSaveConfig: PropTypes.func.isRequired,
};
