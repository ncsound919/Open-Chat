import React, { useEffect, useState, useCallback } from "react";
import PropTypes from "prop-types";
import { BackIcon } from "./icons/Icons.jsx";
import { detectLocalModels, formatBytes, loadMediaPipe, getPreferredBackend, setPreferredBackend, reloadMediaPipeWithBackend } from "../utils/modelRegistry.js";
import { modelServerToBot } from "../utils/localModels.js";
import { KeywireVault } from "./KeywireVault.jsx";

/**
 * GeneralSettings — the app's real settings menu (not tied to any single bot).
 * Hosts the local-model scan (on-device MediaPipe bundles + OpenAI-compatible
 * servers) and a link into Private Local chat.
 */
export function GeneralSettings({
  onBack,
  onOpenMenu,
  onChatLocal,
  onSelectLocalModel,
  onAddServerBot,
  keywireConfig,
  onSaveKeywireConfig,
}) {
  const [sources, setSources] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(null);
  const [scanError, setScanError] = useState(null);
  // GPU is opt-in: MediaPipe's GPU path garbles output on some devices
  // (detokenizer FP16 bug). The chat loop auto-degrades to CPU on corruption.
  const [gpuPref, setGpuPref] = useState(() => getPreferredBackend() === "gpu");

  const toggleGpu = async () => {
    const next = !gpuPref;
    setGpuPref(next);
    setPreferredBackend(next ? "gpu" : "cpu");
    // Apply immediately if a bundle is already loaded.
    await reloadMediaPipeWithBackend(next ? "gpu" : "cpu").catch(() => {});
  };

  const refresh = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const { sources: s } = await detectLocalModels({ includeServers: true });
      setSources(s);
      const total = s.reduce((n, src) => n + src.models.length, 0);
      if (total === 0) {
        setScanError("No local models found. Download a Gemma bundle or start an OpenAI-compatible server.");
      }
    } catch (e) {
      setScanError(`Scan failed: ${e?.message || e}`);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleLoad = async (entry) => {
    const mp = await loadMediaPipe();
    if (!mp?.loadModel) return;
    setLoading(entry.fileName);
    try {
      const res = await mp.loadModel({
        fileName: entry.fileName,
        maxTokens: 4096,
        topK: 40,
        backend: getPreferredBackend(),
      });
      if (res?.ok) onSelectLocalModel?.(entry);
    } catch (e) {
      setScanError(`Load failed: ${e?.message || e}`);
    } finally {
      setLoading(null);
      refresh();
    }
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "52px 16px 16px",
          borderBottom: "1px solid #1a1a26",
        }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
          style={{ background: "none", border: "none", color: "#22d3ee", cursor: "pointer", display: "flex" }}
        >
          <BackIcon />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "#f6f7f9" }}>Settings</div>
          <div style={{ fontSize: 12, color: "#8b8b9e" }}>App preferences</div>
        </div>
        {onOpenMenu && (
          <button
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            style={{ background: "#1c1c28", border: "1px solid #2c2c38", borderRadius: 10, width: 36, height: 36, color: "#888", cursor: "pointer", fontSize: 16 }}
          >
            ☰
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#f6f7f9", marginBottom: 10 }}>
          Local Models
        </div>
        <label
          style={{
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
            background: "#12141d", border: "1px solid #2a2a38", borderRadius: 10,
            padding: "10px 12px", marginBottom: 12,
          }}
        >
          <input type="checkbox" checked={gpuPref} onChange={toggleGpu} aria-label="GPU acceleration for on-device model" />
          <span style={{ fontSize: 12, color: "#c8c9d4", lineHeight: 1.5 }}>
            GPU acceleration (experimental — falls back to CPU if output corrupts)
          </span>
        </label>
        <div style={{ fontSize: 12, color: "#8b8b9e", marginBottom: 10, lineHeight: 1.5 }}>
          Detects on-device Gemma bundles and OpenAI-compatible servers (Ollama, LM Studio, llama.cpp, …).
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={refresh}
            disabled={scanning}
            style={{
              background: "#1e3a2f", border: "1px solid #34d39980", borderRadius: 8,
              padding: "10px 16px", color: "#34d399", fontSize: 13, fontWeight: 600,
              cursor: scanning ? "default" : "pointer", flex: 1,
            }}
          >
            {scanning ? "Scanning…" : "Scan for models"}
          </button>
          <button
            onClick={onChatLocal}
            style={{
              background: "#22d3ee", border: "none", borderRadius: 8, padding: "10px 16px",
              color: "#05060a", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Private Local
          </button>
        </div>

        {scanError && (
          <div style={{ background: "#2d1f1f", border: "1px solid #ef444440", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#ef4444", marginBottom: 12 }}>
            {scanError}
          </div>
        )}

        {sources.length === 0 && !scanning && (
          <div style={{ fontSize: 13, color: "#8b8b9e", padding: "8px 0" }}>
            No models detected yet.
          </div>
        )}

        {sources.map((src) => (
          <div key={src.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#8b8b9e", letterSpacing: "0.04em", marginBottom: 8 }}>
              {src.name}
            </div>
            {src.models.map((entry) => (
              <div
                key={entry.id}
                style={{
                  background: "#0e1117", border: "1px solid #2a2a38", borderRadius: 10,
                  padding: "12px 14px", marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#8b8b9e" }}>
                      {entry.kind === "ondevice"
                        ? `${formatBytes(entry.sizeBytes)} · ${entry.loaded ? "loaded" : "not loaded"}`
                        : entry.path}
                    </div>
                  </div>
                  {entry.kind === "ondevice" ? (
                    <button
                      onClick={() => handleLoad(entry)}
                      disabled={loading === entry.fileName}
                      style={{
                        background: entry.loaded ? "#1e3a2f" : "#22d3ee", border: "none", borderRadius: 8,
                        padding: "6px 12px", color: entry.loaded ? "#34d399" : "#05060a",
                        fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                      }}
                    >
                      {loading === entry.fileName ? "Loading…" : entry.loaded ? "Loaded" : "Load"}
                    </button>
                  ) : (
                    <button
                      onClick={() => onAddServerBot?.(entry, entry.path)}
                      style={{
                        background: "#22d3ee", border: "none", borderRadius: 8, padding: "6px 12px",
                        color: "#05060a", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                      }}
                    >
                      Add bot
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        <KeywireVault config={keywireConfig} onSaveConfig={onSaveKeywireConfig} />
      </div>
    </div>
  );
}

GeneralSettings.propTypes = {
  onBack: PropTypes.func.isRequired,
  onOpenMenu: PropTypes.func,
  onChatLocal: PropTypes.func,
  onSelectLocalModel: PropTypes.func,
  onAddServerBot: PropTypes.func,
  keywireConfig: PropTypes.object,
  onSaveKeywireConfig: PropTypes.func,
};

/** Build a chat-ready bot config for a detected OpenAI-compatible server model. */
export function buildServerBot(entry, baseUrl) {
  return modelServerToBot({ name: entry.name, baseUrl, models: [entry.name] }, entry.name);
}
