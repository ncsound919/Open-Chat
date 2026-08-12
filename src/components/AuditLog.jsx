import React, { useState } from "react";
import PropTypes from "prop-types";

const SOURCES = ["all", "tool", "notification", "chain", "workflow", "worker"];

const SOURCE_LABEL = {
  tool: "Tools",
  notification: "Notifications",
  chain: "Chains",
  workflow: "Workflows",
  worker: "Workers",
};

/**
 * Build a unified, chronological audit feed from every agent-activity source:
 * tool executions, Draymond notifications, chain updates, workflows, and
 * worker-task completions. Newest first.
 */
export function buildAuditEntries({ toolLog = [], notifications = [], chains = [], workflows = {}, workerTasks = [] }) {
  const entries = [];

  for (const t of toolLog) {
    entries.push({
      key: `tool-${t.executionId || `${t.timestamp}-${Math.random()}`}`,
      time: Number(t.timestamp) || 0,
      source: "tool",
      title: t.toolName || t.action || "Unknown Action",
      agentId: t.agentId,
      status: t.status || (t.error ? "failed" : "completed"),
      parameters: t.parameters,
      result: t.result,
      error: t.error,
    });
  }

  for (const n of notifications) {
    const data = n?.data ?? n;
    const title =
      data?.title || (typeof n?.type === "string" ? n.type : "notification");
    const body =
      typeof data === "string"
        ? data
        : data?.message || data?.body || data?.text || "";
    entries.push({
      key: `ntf-${n.receivedAt || Date.now()}-${Math.random()}`,
      time: Number(n.receivedAt) || Date.now(),
      source: "notification",
      title: String(title),
      agentId: data?.agent_id || (typeof n?.type === "string" ? n.type : ""),
      status: /failed/i.test(String(title)) ? "failed" : "completed",
      result: String(body),
    });
  }

  for (const c of chains) {
    const type = String(c?.type || c?.event || "");
    const status = /failed/i.test(type)
      ? "failed"
      : /completed|done/i.test(type)
      ? "completed"
      : "in_progress";
    entries.push({
      key: `chain-${c?.chain_instance_id || c?.chain_id || Math.random()}`,
      time: Number(c?.ts || c?.timestamp) || Date.now(),
      source: "chain",
      title: `Chain: ${c?.chain_slug || c?.chain_instance_id || "?"}`,
      agentId: c?.step_name || c?.step || "",
      status,
      result: String(c?.output || c?.message || c?.step || "").slice(0, 400),
    });
  }

  for (const wf of Object.values(workflows || {})) {
    entries.push({
      key: `wf-${wf?.id || Math.random()}`,
      time: Number(wf?.startTime || wf?.endTime) || Date.now(),
      source: "workflow",
      title: `Workflow: ${wf?.id || "?"}`,
      agentId: wf?.currentPhase || "",
      status: wf?.status || "in_progress",
      result: wf?.currentPhase || "",
    });
  }

  for (const t of workerTasks) {
    const status =
      t?.status === "completed"
        ? "completed"
        : t?.status === "failed"
        ? "failed"
        : "in_progress";
    entries.push({
      key: `worker-${t?.id || Math.random()}`,
      time: Number(t?.completed_at || t?.claimed_at) || Date.now(),
      source: "worker",
      title: `Worker task: ${t?.skill_pack_id || t?.id || "?"}`,
      agentId: t?.worker_id || "",
      status,
      result: String(t?.result || "").slice(0, 400),
    });
  }

  return entries.sort((a, b) => b.time - a.time);
}

/**
 * Audit Log — the fleet's audit trail. Chronological feed of every agent
 * action (tools, notifications, chains, workflows, worker tasks) with search,
 * status, and source filters. Read-only: nothing here is mutable.
 */
export function AuditLog({
  toolLog,
  notifications = [],
  chains = [],
  workflows = {},
  workerTasks = [],
  onClose,
}) {
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const entries = buildAuditEntries({ toolLog, notifications, chains, workflows, workerTasks });

  const filtered = entries.filter((entry) => {
    const haystack = `${entry.title} ${entry.agentId || ""} ${entry.status} ${entry.source}`.toLowerCase();
    const matchesText = !filter || haystack.includes(filter.toLowerCase());

    const matchesType =
      typeFilter === "all" ||
      entry.status === typeFilter ||
      (typeFilter === "error" && entry.error);

    const matchesSource =
      sourceFilter === "all" || entry.source === sourceFilter;

    return matchesText && matchesType && matchesSource;
  });

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getStatusColor = (entry) => {
    if (entry.error || entry.status === "failed") return "#ef4444";
    if (entry.status === "completed" || entry.status === "success")
      return "#10b981";
    if (entry.status === "in_progress") return "#f59e0b";
    return "#6b7280";
  };

  const getStatusIcon = (entry) => {
    if (entry.error || entry.status === "failed") return "✗";
    if (entry.status === "completed" || entry.status === "success") return "✓";
    if (entry.status === "in_progress") return "⟳";
    return "•";
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0d0d14",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#1c1c28",
          borderRadius: 16,
          width: "90%",
          maxWidth: 900,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px #00000080",
          border: "1px solid #2a2a38",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #2a2a38",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "#e8e8f0",
                margin: 0,
              }}
            >
              Audit Log
            </h2>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "#666680",
                fontSize: 24,
                cursor: "pointer",
                padding: 4,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Search by tool, agent, or status..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                flex: 1,
                background: "#0d0d14",
                border: "1px solid #2a2a38",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#e8e8f0",
                fontSize: 14,
                outline: "none",
              }}
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{
                background: "#0d0d14",
                border: "1px solid #2a2a38",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#e8e8f0",
                fontSize: 14,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">All States</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="error">Errors</option>
            </select>
          </div>

          {/* Source chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SOURCES.map((src) => {
              const active = sourceFilter === src;
              const label = src === "all" ? "All sources" : SOURCE_LABEL[src];
              return (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  style={{
                    background: active ? "#22d3ee" : "#0d0d14",
                    border: active ? "1px solid #22d3ee" : "1px solid #2a2a38",
                    borderRadius: 999,
                    padding: "4px 12px",
                    color: active ? "#05060a" : "#8b8b9e",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Log Entries */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 24px",
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#666680",
              }}
            >
              {entries.length === 0
                ? "No audit log entries yet"
                : "No entries match your filters"}
            </div>
          ) : (
            filtered.map((entry) => (
              <div
                key={entry.key}
                style={{
                  background: "#0d0d14",
                  borderRadius: 10,
                  padding: "14px 16px",
                  marginBottom: 10,
                  border: "1px solid #2a2a38",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  {/* Status Icon */}
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: `${getStatusColor(entry)}20`,
                      border: `1.5px solid ${getStatusColor(entry)}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: getStatusColor(entry),
                      fontSize: 12,
                      fontWeight: "bold",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {getStatusIcon(entry)}
                  </div>

                  {/* Entry Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 500,
                          color: "#e8e8f0",
                        }}
                      >
                        {entry.title}
                      </span>
                      {entry.agentId && (
                        <span
                          style={{
                            fontSize: 12,
                            color: "#666680",
                            background: "#ffffff10",
                            padding: "2px 8px",
                            borderRadius: 4,
                          }}
                        >
                          {entry.agentId}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 10,
                          color: "#555568",
                          background: "#ffffff08",
                          padding: "2px 8px",
                          borderRadius: 4,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {entry.source}
                      </span>
                    </div>

                    {/* Timestamp */}
                    <div
                      style={{
                        fontSize: 12,
                        color: "#666680",
                        marginBottom: 8,
                      }}
                    >
                      {formatTimestamp(entry.time)}
                    </div>

                    {/* Parameters/Details */}
                    {entry.parameters && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#9090a0",
                          marginBottom: 6,
                          fontFamily: "monospace",
                          background: "#00000030",
                          padding: "6px 10px",
                          borderRadius: 6,
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(entry.parameters, null, 2)}
                      </div>
                    )}

                    {/* Error Message */}
                    {entry.error && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#ef4444",
                          background: "#ef444420",
                          padding: "8px 10px",
                          borderRadius: 6,
                          marginTop: 8,
                          border: "1px solid #ef444440",
                        }}
                      >
                        <strong>Error:</strong> {entry.error}
                      </div>
                    )}

                    {/* Result */}
                    {entry.result !== undefined && entry.result !== "" && !entry.error && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#9090a0",
                          marginTop: 6,
                        }}
                      >
                        Result:{" "}
                        {typeof entry.result === "string"
                          ? entry.result
                          : JSON.stringify(entry.result)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #2a2a38",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "#666680" }}>
            {filtered.length} of {entries.length} entries
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#818cf8",
              color: "#0d0d14",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

AuditLog.propTypes = {
  toolLog: PropTypes.array.isRequired,
  notifications: PropTypes.array,
  chains: PropTypes.array,
  workflows: PropTypes.object,
  workerTasks: PropTypes.array,
  onClose: PropTypes.func.isRequired,
};
