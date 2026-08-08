import React from "react";
import PropTypes from "prop-types";

const TASK_COLORS = {
  queued: "#f59e0b",
  claimed: "#3b82f6",
  in_progress: "#22d3ee",
  completed: "#22c55e",
  failed: "#ef4444",
  needs_review: "#a855f7",
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
 * WorkScreen — queued Draymond worker tasks assigned to this device, the
 * locally cached skill library, and a "Propose skill" action. The worker
 * loop (pull/claim/report) lives elsewhere; this screen renders state.
 */
export function WorkScreen({
  tasks = [],
  localSkills = [],
  onProposeSkill,
  onRunTask,
  onOpenMenu = null,
}) {
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
              }}
            >
              Work
            </h1>
          </div>
        </div>
        <p style={{ color: "#666679", fontSize: 13, margin: 0 }}>
          Tasks queued by Draymond · skills cached locally
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
        <div style={sectionStyle}>
          <div style={{ fontSize: 12, color: "#555568", margin: "8px 0" }}>
            ASSIGNED TASKS
          </div>
          {tasks.length === 0 && <div style={emptyStyle}>No tasks assigned yet.</div>}
          {tasks.map((t) => {
            const color = TASK_COLORS[t.status] || "#888";
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
                    {t.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#666679", marginTop: 4 }}>
                  id: {t.id} · due: {t.due_at || "asap"}
                </div>
                {t.status === "queued" && (
                  <button
                    onClick={() => onRunTask && onRunTask(t)}
                    style={{ ...btnStyle, marginTop: 10 }}
                  >
                    Run now
                  </button>
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
            onClick={onProposeSkill}
            style={{
              ...btnStyle,
              width: "100%",
              padding: "10px 14px",
            }}
          >
            Propose skill
          </button>
        </div>
      </div>
    </div>
  );
}

WorkScreen.propTypes = {
  tasks: PropTypes.array,
  localSkills: PropTypes.array,
  onProposeSkill: PropTypes.func,
  onRunTask: PropTypes.func,
  onOpenMenu: PropTypes.func,
};
