import React, { useEffect, useState, useCallback } from "react";
import PropTypes from "prop-types";
import {
  detectLocalModels,
  MEDIAPIPE_DEFAULT_MODELS,
  formatBytes,
  loadMediaPipe,
  loadPhoneControl,
} from "../utils/modelRegistry.js";
import { resolveProvider, PROVIDER } from "../utils/localChat.js";
import { runBenchmarks } from "../utils/runBenchmarks.js";
import { runSkillTests } from "../utils/skillTests.js";
import { buildBenchmarkRows } from "../utils/benchmarks.js";
import { discoverApps, summarizeCapabilities } from "../utils/appRegistry.js";

/**
 * ModelsScreen — detect, download, load, and chat with on-device models.
 * Shows MediaPipe Gemma bundles, system runtimes (Nano/WebLLM), LAN servers,
 * and the phone-control accessibility status.
 */
export function ModelsScreen({
  onChatLocal,
  onSelectLocalModel,
  onOpenMenu = null,
  onSyncBenchmarks = null,
}) {
  const [sources, setSources] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState({}); // fileName -> progress
  const [loading, setLoading] = useState(null); // fileName
  const [log, setLog] = useState([]);
  const [provider, setProvider] = useState(PROVIDER.NONE);
  const [accessibility, setAccessibility] = useState({ available: false, enabled: false });
  const [backend, setBackend] = useState("gpu"); // gpu | auto (NPU) | cpu
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchResults, setBenchResults] = useState(null);
  const [capabilities, setCapabilities] = useState(null);

  const appendLog = useCallback((line) => {
    setLog((prev) => [...prev.slice(-50), line]);
  }, []);

  const refresh = useCallback(async () => {
    setScanning(true);
    try {
      const { sources: s } = await detectLocalModels({ includeServers: true });
      setSources(s);
    } catch (e) {
      appendLog(`Detection error: ${e.message}`);
    } finally {
      setScanning(false);
    }
  }, [appendLog]);

  useEffect(() => {
    refresh();
    resolveProvider().then(setProvider);
    loadPhoneControl()
      .then((pc) => (pc ? pc.getStatus() : null))
      .then((s) => setAccessibility({ available: true, enabled: s?.enabled === true }))
      .catch(() => {});
    discoverApps()
      .then((r) => setCapabilities({ count: r.count, buckets: summarizeCapabilities(r.apps) }))
      .catch(() => {});
  }, [refresh]);

  const handleDownload = async (entry) => {
    const mp = await loadMediaPipe();
    if (!mp) {
      appendLog("MediaPipe runtime unavailable on this build.");
      return;
    }
    const handle = await mp.addListener("model:progress", (data) => {
      if (data?.fileName === entry.fileName) {
        setDownloading((prev) => ({ ...prev, [entry.fileName]: data.progress ?? 0 }));
      }
    });
    setDownloading((prev) => ({ ...prev, [entry.fileName]: 0 }));
    appendLog(`Downloading ${entry.name} (${formatBytes(entry.sizeBytes)})…`);
    try {
      await mp.downloadModel({ url: entry.url, fileName: entry.fileName });
      appendLog(`${entry.name} downloaded.`);
      await refresh();
    } catch (e) {
      appendLog(`Download failed: ${e.message}`);
    } finally {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[entry.fileName];
        return next;
      });
      handle?.remove?.();
    }
  };

  const handleLoad = async (entry) => {
    const mp = await loadMediaPipe();
    if (!mp) return;
    setLoading(entry.fileName);
    appendLog(`Loading ${entry.name} into GPU/NPU…`);
    try {
      const res = await mp.loadModel({
        fileName: entry.fileName,
        maxTokens: 4096,
        topK: 40,
        backend,
      });
      if (res?.ok) {
        appendLog(`${entry.name} ready (backend: ${res?.backend ?? backend}).`);
        onSelectLocalModel?.(entry);
      }
    } catch (e) {
      appendLog(`Load failed: ${e.message}`);
    } finally {
      setLoading(null);
      // Refresh both the model list and the active engine status.
      await refresh();
      resolveProvider().then(setProvider).catch(() => {});
    }
  };

  const handleDelete = async (entry) => {
    const mp = await loadMediaPipe();
    if (!mp) return;
    try {
      await mp.deleteModel({ fileName: entry.fileName });
      appendLog(`${entry.name} deleted.`);
      await refresh();
    } catch (e) {
      appendLog(`Delete failed: ${e.message}`);
    }
  };

  /** Run the benchmark + skill-test suite and optionally sync to Draymond. */
  const handleRunBenchmarks = async () => {
    setBenchmarking(true);
    setBenchResults(null);
    appendLog("Starting benchmark + skill test run…");
    try {
      const run = await runBenchmarks({
        backend,
        onProgress: (line) => appendLog(line),
      });
      const skills = await runSkillTests({
        phoneControl: await loadPhoneControl().catch(() => null),
        onProgress: (line) => appendLog(line),
      });
      const combined = {
        ...run,
        skillTests: skills,
      };
      setBenchResults(combined);
      appendLog(`Run ${combined.runId} complete — ${combined.results.length} benches, ${skills.length} skill tests.`);

      if (typeof onSyncBenchmarks === "function") {
        const rows = buildBenchmarkRows(run.runId, [
          ...run.results,
          ...skills.map((s) => ({
            slug: `skill.${s.name}`,
            name: `Skill: ${s.name}`,
            metrics: { ok: s.ok, ms: s.ms, detail: s.detail },
            weakness_score: s.ok ? 0 : 50,
            evidence: s.detail,
          })),
        ]);
        const sync = await onSyncBenchmarks(rows);
        appendLog(sync?.ok ? `Synced ${sync.count} rows to Draymond.` : `Draymond sync: ${sync?.error ?? "failed"}`);
      }
    } catch (e) {
      appendLog(`Benchmark failed: ${e.message}`);
    } finally {
      setBenchmarking(false);
    }
  };

  const handleEnableAccessibility = async () => {
    const pc = await loadPhoneControl();
    if (!pc) return;
    await pc.openAccessibilitySettings();
  };

  const allModels = sources.flatMap((s) => s.models);

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
                style={{
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
                }}
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
              Models
            </h1>
          </div>
          <button
            onClick={refresh}
            style={{
              background: "#1c1c28",
              border: "1px solid #2c2c38",
              borderRadius: 8,
              padding: "5px 12px",
              fontSize: 12,
              color: "#88889a",
              cursor: "pointer",
            }}
          >
            {scanning ? "Scanning…" : "Rescan"}
          </button>
        </div>
        <p style={{ color: "#666679", fontSize: 13, margin: 0 }}>
          On-device inference · nothing leaves the phone
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
        {/* Active runtime */}
        <div style={{ padding: "0 20px 12px" }}>
          <div
            data-testid="engine-status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#15151f",
              border: "1px solid #22222e",
              borderRadius: 12,
              padding: "10px 14px",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: provider === PROVIDER.NONE ? "#444" : "#34d399",
                boxShadow: provider === PROVIDER.NONE ? "none" : "0 0 8px #34d399",
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#e0e0ea", fontWeight: 600 }}>
                Private chat engine
              </div>
              <div style={{ fontSize: 12, color: "#555568" }}>
                {provider === PROVIDER.MEDIAPIPE || provider === PROVIDER.LITERT_LM
                  ? "LiteRT-LM · CPU/GPU"
                  : provider === PROVIDER.NANO
                    ? "Gemini Nano"
                    : provider === PROVIDER.WEBLLM
                      ? "WebLLM (WebGPU)"
                      : "No model loaded — download one below"}
              </div>
            </div>
            <button
              onClick={onChatLocal}
              style={{
                background: "#34d399",
                color: "#05060a",
                border: "none",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Chat privately
            </button>
          </div>
        </div>

        {/* Accessibility service */}
        <div style={{ padding: "0 20px 12px" }}>
          <div
            style={{
              background: accessibility.enabled ? "#34d39914" : "#f5c45114",
              border: `1px solid ${accessibility.enabled ? "#34d39930" : "#f5c45130"}`,
              borderRadius: 12,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 13, color: "#e0e0ea", fontWeight: 600 }}>
              Phone control
            </div>
            <div style={{ fontSize: 12, color: "#555568", margin: "2px 0 8px" }}>
              {accessibility.enabled
                ? "Accessibility service enabled — Gemma can drive your apps."
                : "Enable the accessibility service so Gemma can tap, type, and open apps for you."}
            </div>
            {!accessibility.enabled && (
              <button
                onClick={handleEnableAccessibility}
                style={{
                  background: "#f5c451",
                  color: "#05060a",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Enable in system settings
              </button>
            )}
          </div>
        </div>

        {/* Capabilities — what Open Chat can affect on this phone */}
        <div style={{ padding: "0 20px 12px" }}>
          <div
            style={{
              background: "#15151f",
              border: "1px solid #22222e",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f5", marginBottom: 4 }}>
              Phone capabilities
            </div>
            <div style={{ fontSize: 12, color: "#555568", marginBottom: 8 }}>
              {capabilities
                ? `Gemma can open and drive ${capabilities.count} installed apps.`
                : "Scanning installed apps…"}
            </div>
            {capabilities?.buckets?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {capabilities.buckets.map((b) => (
                  <span
                    key={b.key}
                    style={{
                      fontSize: 10,
                      color: b.risk === "high" ? "#f5c451" : b.risk === "medium" ? "#9fe8d5" : "#88889a",
                      background: b.risk === "high" ? "#f5c45118" : b.risk === "medium" ? "#34d39918" : "#1c1c28",
                      border: "1px solid",
                      borderColor: b.risk === "high" ? "#f5c45130" : b.risk === "medium" ? "#34d39930" : "#2c2c38",
                      borderRadius: 6,
                      padding: "3px 8px",
                    }}
                  >
                    {b.label}: {b.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Catalog + installed */}
        <div style={{ padding: "0 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: "#555568" }}>Accelerator:</span>
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value)}
              aria-label="Inference accelerator"
              style={{
                background: "#1c1c28",
                color: "#e0e0ea",
                border: "1px solid #2c2c38",
                borderRadius: 8,
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <option value="gpu">GPU</option>
              <option value="auto">Auto (NPU/GPU)</option>
              <option value="cpu">CPU</option>
            </select>
            <span style={{ fontSize: 11, color: "#555568" }}>
              Applies on next Load
            </span>
          </div>

          {/* Benchmark + skill tests */}
          <div
            style={{
              background: "#15151f",
              border: "1px solid #22222e",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f5" }}>
                Benchmark &amp; skill tests
              </div>
              <button
                onClick={handleRunBenchmarks}
                disabled={benchmarking}
                style={{
                  background: benchmarking ? "#2c2c38" : "#22d3ee",
                  color: "#05060a",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: benchmarking ? "default" : "pointer",
                }}
              >
                {benchmarking ? "Running…" : "Run benchmark"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#555568", lineHeight: 1.5 }}>
              Measures model load &amp; generation speed, Galaxy AI + phone skills, and verification. Results sync to Draymond as a self-learning baseline.
            </div>
            {benchResults && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "#666679", marginBottom: 4 }}>
                  Run {benchResults.runId}
                </div>
                {benchResults.results.map((r) => (
                  <div key={r.slug} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#e0e0ea", padding: "3px 0" }}>
                    <span>{r.name}</span>
                    <span style={{ color: r.metrics?.ok === false ? "#ef4444" : "#34d399" }}>
                      {formatMetric(r.metrics)}
                    </span>
                  </div>
                ))}
                {benchResults.skillTests?.length > 0 && (
                  <div style={{ marginTop: 6, borderTop: "1px solid #22222e", paddingTop: 6 }}>
                    <div style={{ fontSize: 12, color: "#666679", marginBottom: 4 }}>
                      Skill tests: {benchResults.skillTests.filter((s) => s.ok).length}/{benchResults.skillTests.length} passed
                    </div>
                    {benchResults.skillTests.map((s) => (
                      <div key={s.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#e0e0ea", padding: "2px 0" }}>
                        <span>{s.name}</span>
                        <span style={{ color: s.ok ? "#34d399" : "#ef4444" }}>{s.ok ? `${s.ms}ms` : s.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: "#555568", margin: "8px 0" }}>
            GEMMA CATALOG
          </div>
          {MEDIAPIPE_DEFAULT_MODELS.map((entry) => {
            const installed = allModels.find((m) => m.fileName === entry.fileName);
            const dl = downloading[entry.fileName];
            const busy = loading === entry.fileName;
            return (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "#15151f",
                  border: "1px solid #22222e",
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f5" }}>
                    {entry.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#555568" }}>
                    {entry.tagline} · {formatBytes(entry.sizeBytes)}
                  </div>
                  {dl !== undefined && (
                    <div
                      style={{
                        height: 4,
                        background: "#22222e",
                        borderRadius: 2,
                        marginTop: 8,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${dl}%`,
                          background: "#22d3ee",
                          transition: "width .3s",
                        }}
                      />
                    </div>
                  )}
                </div>
                {installed ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    {installed.loaded || busy ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#34d399",
                          background: "#34d39918",
                          borderRadius: 6,
                          padding: "4px 10px",
                        }}
                      >
                        {busy ? "Loading…" : "Loaded"}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleLoad(entry)}
                        style={smallBtn("#34d399")}
                      >
                        Load
                      </button>
                    )}
                    <button onClick={() => handleDelete(entry)} style={smallBtn("#ef4444")}>
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDownload(entry)}
                    disabled={dl !== undefined}
                    style={{
                      ...smallBtn("#22d3ee"),
                      opacity: dl !== undefined ? 0.6 : 1,
                    }}
                  >
                    {dl !== undefined ? `${dl}%` : "Download"}
                  </button>
                )}
              </div>
            );
          })}

          {sources.map((src) => (
            <div key={src.id}>
              <div style={{ fontSize: 12, color: "#555568", margin: "8px 0" }}>
                {src.name.toUpperCase()}
              </div>
              {src.models.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "#15151f",
                    border: "1px solid #22222e",
                    borderRadius: 12,
                    padding: "12px 14px",
                    marginBottom: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f5" }}>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#555568" }}>{m.tagline}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: m.loaded ? "#34d399" : "#888",
                      background: m.loaded ? "#34d39918" : "#1c1c28",
                      borderRadius: 6,
                      padding: "4px 10px",
                    }}
                  >
                    {m.loaded ? "Ready" : "Detected"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Activity log */}
        {log.length > 0 && (
          <div style={{ padding: "12px 20px 4px" }}>
            <div style={{ fontSize: 12, color: "#555568", marginBottom: 6 }}>
              ACTIVITY
            </div>
            {log.slice(-5).map((line, i) => (
              <div key={i} style={{ fontSize: 12, color: "#77778a", marginBottom: 3 }}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function smallBtn(color) {
  return {
    background: "transparent",
    border: `1px solid ${color}55`,
    color,
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

/** Compact display of a metrics object. */
function formatMetric(metrics) {
  if (!metrics) return "—";
  if (metrics.ok === false) return "FAIL";
  if (metrics.tokens_per_sec) return `${metrics.tokens_per_sec} tok/s · ${metrics.avg_ms ?? metrics.ms}ms`;
  if (metrics.avg_ms) return `${metrics.avg_ms}ms`;
  if (metrics.ms != null) return `${metrics.ms}ms`;
  if (metrics.provider) return metrics.provider;
  if (metrics.ok === true) return "ok";
  return "—";
}

ModelsScreen.propTypes = {
  onChatLocal: PropTypes.func.isRequired,
  onSelectLocalModel: PropTypes.func,
  onOpenMenu: PropTypes.func,
  onSyncBenchmarks: PropTypes.func,
};
