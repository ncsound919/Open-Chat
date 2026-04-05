import React, { useState } from "react";
import PropTypes from "prop-types";

/**
 * Audit Log Viewer
 * Displays a chronological log of agent actions and system events
 */
export function AuditLog({ toolLog, onClose }) {
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // Sort entries newest-first (slice to avoid mutating the prop)
  const entries = toolLog.slice().sort(
    (a, b) => b.timestamp - a.timestamp
  );

  // Apply filters
  const filtered = entries.filter((entry) => {
    const matchesText =
      !filter ||
      entry.toolName?.toLowerCase().includes(filter.toLowerCase()) ||
      entry.agentId?.toLowerCase().includes(filter.toLowerCase()) ||
      entry.status?.toLowerCase().includes(filter.toLowerCase());

    const matchesType =
      typeFilter === "all" ||
      entry.status === typeFilter ||
      (typeFilter === "error" && entry.error);

    return matchesText && matchesType;
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
        background: "#0d0d14e0",
        backdropFilter: "blur(4px)",
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
          <div style={{ display: "flex", gap: 12 }}>
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
              <option value="all">All Events</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="error">Errors</option>
            </select>
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
                key={entry.executionId || entry.timestamp}
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
                    {/* Tool/Agent Info */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 500,
                          color: "#e8e8f0",
                        }}
                      >
                        {entry.toolName || entry.action || "Unknown Action"}
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
                    </div>

                    {/* Timestamp */}
                    <div
                      style={{
                        fontSize: 12,
                        color: "#666680",
                        marginBottom: 8,
                      }}
                    >
                      {formatTimestamp(entry.timestamp)}
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
                    {entry.result && !entry.error && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#9090a0",
                          marginTop: 6,
                        }}
                      >
                        Result: {typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result)}
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
  onClose: PropTypes.func.isRequired,
};
