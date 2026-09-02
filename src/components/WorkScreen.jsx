import React, { useState } from "react";
import PropTypes from "prop-types";

const TASK_COLORS = {
  queued: "#f59e0b",
  claimed: "#3b82f6",
  in_progress: "#22d3ee",
  completed: "#22c55e",
  failed: "#ef4444",
  needs_review: "#a855f7",
};

const STATUS_COLOR = {
  idle: "#555568",
  connecting: "#f59e0b",
  connected: "#22c55e",
  working: "#22d3ee",
  error: "#ef4444",
  stopped: "#555568",
};

const cardStyle = {
  background: "#15151f",
  border: "1px solid #22222e",
  borderRadius: 12,
  padding: "12px 14px",
  marginBottom: 10,
};

const sectionStyle = {
  padding: "0 20px",
};

const btnStyle = {
  background: "#22d3ee",
  color: "#05060a",
  border: "none",
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const menuBtn = {
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
};

const emptyStyle = {
  textAlign: "center",
  padding: "40px 24px",
  color: "#444455",
  fontSize: 14,
};

/**
 * WorkScreen — the on-device worker console. Shows Draymond-assigned tasks,
 * the locally cached skill library, the worker connection status, and lets the
 * user run a queued task, refresh, or propose a new skill pack to Draymond.
 */
export function WorkScreen({
  tasks = [],
  localSkills = [],
  status = "idle",
  lastError = null,
  runningTaskId = null,
  workerId = "open-chat",
  lastPullAt = null,
  onRunTask,
  onProposeSkill,
  onRefresh,
  onOpenMenu = null,
}) {
  const [proposing, setProposing] = useState(false);
  const [proposalName, setProposalName] = useState("");
  const [proposalPurpose, setProposalPurpose] = useState("");
  const [proposalTools, setProposalTools] = useState("");
  const [proposalStatus, setProposalStatus] = useState("idle");

  const submitProposal = async () => {
    const name = proposalName.trim();
    if (!name) return;
    setProposalStatus("sending");
    const pack = {
      name,
      version: "1.0.0",
      purpose: proposalPurpose.trim() || "Proposed from Open Chat",
      tools: proposalTools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      platforms: ["android", "web", "electron"],
      outputs: [],
    };
    try {
      const result = await onProposeSkill(pack);
      setProposalStatus(result?.ok ? "ok" : "error");
      if (result?.ok) {
        setProposalName("");
        setProposalPurpose("");
        setProposalTools("");
        setProposing(false);
      }
    } catch {
      // A throwing proposal must not leave the button stuck on "Submitting…".
      setProposalStatus("error");
    } finally {
      setTimeout(() => setProposalStatus("idle"), 2500);
    }
  };

  const statusColor = STATUS_COLOR[status] || "#555568";

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
                style={menuBtn}
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
                margin: 0,
              }}
            >
              Work
            </h1>
          </div>
        </div>
        <p style={{ color: "#666679", fontSize: 13, margin: 0 }}>
          Tasks queued by Draymond · skills cached locally
        </p>

        {/* Worker status */}
        <div
          style={{
            ...cardStyle,
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 12,
            marginBottom: 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f5" }}>
              Worker {status}
              {runningTaskId ? " · running" : ""}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#666679",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {workerId}
              {lastPullAt ? ` · pulled ${new Date(lastPullAt).toLocaleTimeString()}` : ""}
            </div>
          </div>
          {onRefresh && (
            <button
              onClick={() => onRefresh && onRefresh()}
              aria-label="Refresh tasks"
              title="Refresh tasks and skills"
              style={{ ...btnStyle, background: "#1c1c28", color: "#e0e0f0" }}
            >
              Refresh
            </button>
          )}
        </div>
        {lastError && (
          <div
            style={{
              fontSize: 11,
              color: "#ef4444",
              marginTop: 8,
              background: "#ef444418",
              borderRadius: 8,
              padding: "6px 10px",
            }}
          >
            {lastError}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
        <div style={sectionStyle}>
          <div style={{ fontSize: 12, color: "#555568", margin: "8px 0" }}>
            ASSIGNED TASKS
          </div>
          {tasks.length === 0 && <div style={emptyStyle}>No tasks assigned yet.</div>}
          {tasks.map((t) => {
            const color = TASK_COLORS[t.status] || "#888";
            const running = t.id === runningTaskId;
            return (
              <div key={t.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: "#f0f0f5",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.skill_pack_id || t.id}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color,
                      background: `${color}18`,
                      borderRadius: 6,
                      padding: "3px 8px",
                      flexShrink: 0,
                    }}
                  >
                    {running ? "running" : t.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#666679", marginTop: 4 }}>
                  id: {t.id} · due: {t.due_at ?? "asap"}
                </div>
                {t.status === "queued" && onRunTask && (
                  <button
                    onClick={() => onRunTask(t)}
                    disabled={!!runningTaskId}
                    style={{ ...btnStyle, marginTop: 10, opacity: runningTaskId ? 0.5 : 1 }}
                  >
                    Run now
                  </button>
                )}
                {t.error && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#ef4444",
                      marginTop: 8,
                      background: "#ef444418",
                      borderRadius: 6,
                      padding: "4px 8px",
                    }}
                  >
                    {t.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ ...sectionStyle, marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#555568", margin: "8px 0" }}>
            SKILL LIBRARY
          </div>
          {localSkills.length === 0 && <div style={emptyStyle}>No skills cached yet.</div>}
          {localSkills.map((skill) => {
            const [name, version] = String(skill).split(":");
            return (
              <div key={skill} style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f5" }}>
                  {name}
                </div>
                {version && (
                  <div style={{ fontSize: 12, color: "#555568", marginTop: 2 }}>
                    version {version}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ ...sectionStyle, marginTop: 12 }}>
          <button
            onClick={() => setProposing((v) => !v)}
            style={{
              ...btnStyle,
              width: "100%",
              padding: "10px 14px",
              background: proposing ? "#1c1c28" : "#22d3ee",
              color: proposing ? "#e0e0f0" : "#05060a",
            }}
          >
            {proposing ? "Cancel" : "Propose skill"}
          </button>

          {proposing && (
            <div
              style={{
                marginTop: 10,
                ...cardStyle,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <input
                value={proposalName}
                onChange={(e) => setProposalName(e.target.value)}
                placeholder="Skill name (e.g. daily-report)"
                style={inputStyle}
              />
              <input
                value={proposalPurpose}
                onChange={(e) => setProposalPurpose(e.target.value)}
                placeholder="Purpose"
                style={inputStyle}
              />
              <input
                value={proposalTools}
                onChange={(e) => setProposalTools(e.target.value)}
                placeholder="Tools (comma-separated: capture, text, notify)"
                style={inputStyle}
              />
              <button
                onClick={submitProposal}
                disabled={proposalStatus === "sending" || !proposalName.trim()}
                style={{ ...btnStyle, width: "100%" }}
              >
                {proposalStatus === "sending"
                  ? "Submitting…"
                  : proposalStatus === "ok"
                    ? "✓ Proposed"
                    : proposalStatus === "error"
                      ? "✕ Failed — retry"
                      : "Submit proposal"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  background: "#0e1117",
  border: "1px solid #2a2a3a",
  borderRadius: 8,
  padding: "8px 10px",
  color: "#e8e8f0",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

WorkScreen.propTypes = {
  tasks: PropTypes.array,
  localSkills: PropTypes.array,
  status: PropTypes.string,
  lastError: PropTypes.string,
  runningTaskId: PropTypes.string,
  workerId: PropTypes.string,
  lastPullAt: PropTypes.string,
  onRunTask: PropTypes.func,
  onProposeSkill: PropTypes.func,
  onRefresh: PropTypes.func,
  onOpenMenu: PropTypes.func,
};
