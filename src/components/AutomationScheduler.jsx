import React, { useState } from "react";
import PropTypes from "prop-types";

/**
 * Automation Scheduler
 * Configure cron jobs and scheduled tasks for agents
 */
export function AutomationScheduler({ schedules, onCreateSchedule, onUpdateSchedule, onDeleteSchedule, onClose }) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    name: "",
    cronExpression: "0 0 * * *",
    action: "",
    parameters: "{}",
    enabled: true,
  });
  const [error, setError] = useState("");

  const handleCreate = () => {
    setError("");

    if (!newSchedule.name.trim()) {
      setError("Schedule name is required");
      return;
    }

    if (!newSchedule.action.trim()) {
      setError("Action is required");
      return;
    }

    try {
      const parameters = JSON.parse(newSchedule.parameters);
      onCreateSchedule({
        ...newSchedule,
        parameters,
        id: Date.now().toString(),
        createdAt: Date.now(),
      });
      setNewSchedule({
        name: "",
        cronExpression: "0 0 * * *",
        action: "",
        parameters: "{}",
        enabled: true,
      });
      setShowCreateForm(false);
    } catch (e) {
      setError(`Invalid JSON parameters: ${e.message}`);
    }
  };

  const toggleSchedule = (id) => {
    const schedule = schedules.find((s) => s.id === id);
    if (schedule) {
      onUpdateSchedule(id, { ...schedule, enabled: !schedule.enabled });
    }
  };

  const getCronDescription = (cronExpression) => {
    // Simple cron description parser
    const parts = cronExpression.split(" ");
    if (parts.length < 5) return "Invalid cron expression";

    if (cronExpression === "0 0 * * *") return "Daily at midnight";
    if (cronExpression === "0 * * * *") return "Every hour";
    if (cronExpression === "*/5 * * * *") return "Every 5 minutes";
    if (cronExpression === "0 0 * * 0") return "Weekly on Sunday";
    if (cronExpression === "0 0 1 * *") return "Monthly on the 1st";

    return cronExpression;
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
          maxWidth: 800,
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
              marginBottom: 12,
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
              Automation Scheduler
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
          <div style={{ fontSize: 13, color: "#9090a0" }}>
            Schedule automated tasks and cron jobs for your agents
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
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
            <div style={{ fontSize: 14, fontWeight: 500, color: "#e8e8f0" }}>
              Scheduled Tasks
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              style={{
                background: "#818cf8",
                color: "#0d0d14",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              + New Schedule
            </button>
          </div>

          {/* Create Form */}
          {showCreateForm && (
            <div
              style={{
                background: "#0d0d14",
                border: "1px solid #2a2a38",
                borderRadius: 8,
                padding: "16px",
                marginBottom: 16,
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Schedule Name
                </label>
                <input
                  type="text"
                  value={newSchedule.name}
                  onChange={(e) =>
                    setNewSchedule({ ...newSchedule, name: e.target.value })
                  }
                  placeholder="Daily backup task"
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Cron Expression
                </label>
                <select
                  value={newSchedule.cronExpression}
                  onChange={(e) =>
                    setNewSchedule({ ...newSchedule, cronExpression: e.target.value })
                  }
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="*/5 * * * *">Every 5 minutes</option>
                  <option value="0 * * * *">Every hour</option>
                  <option value="0 0 * * *">Daily at midnight</option>
                  <option value="0 0 * * 0">Weekly on Sunday</option>
                  <option value="0 0 1 * *">Monthly on the 1st</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Action/Tool Name
                </label>
                <input
                  type="text"
                  value={newSchedule.action}
                  onChange={(e) =>
                    setNewSchedule({ ...newSchedule, action: e.target.value })
                  }
                  placeholder="backup_messages"
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Parameters (JSON)
                </label>
                <textarea
                  data-testid="schedule-parameters"
                  value={newSchedule.parameters}
                  onChange={(e) =>
                    setNewSchedule({ ...newSchedule, parameters: e.target.value })
                  }
                  placeholder='{"destination": "backups/"}'
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 13,
                    fontFamily: "monospace",
                    outline: "none",
                    minHeight: 80,
                    resize: "vertical",
                  }}
                />
              </div>

              {error && (
                <div
                  style={{
                    fontSize: 13,
                    color: "#ef4444",
                    background: "#ef444420",
                    padding: "8px 12px",
                    borderRadius: 6,
                    marginBottom: 12,
                    border: "1px solid #ef444440",
                  }}
                >
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setError("");
                  }}
                  style={{
                    background: "#2a2a38",
                    color: "#e8e8f0",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  style={{
                    background: "#818cf8",
                    color: "#0d0d14",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Create Schedule
                </button>
              </div>
            </div>
          )}

          {/* Schedule List */}
          {schedules.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#666680",
              }}
            >
              No scheduled tasks yet. Create one to automate your workflows.
            </div>
          ) : (
            schedules.map((schedule) => (
              <div
                key={schedule.id}
                style={{
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "14px 16px",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 500,
                        color: "#e8e8f0",
                        marginBottom: 4,
                      }}
                    >
                      {schedule.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#666680", marginBottom: 6 }}>
                      {getCronDescription(schedule.cronExpression)} • {schedule.action}
                    </div>
                    {schedule.parameters && Object.keys(schedule.parameters).length > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#9090a0",
                          fontFamily: "monospace",
                          background: "#00000030",
                          padding: "4px 8px",
                          borderRadius: 4,
                          display: "inline-block",
                        }}
                      >
                        {JSON.stringify(schedule.parameters)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => toggleSchedule(schedule.id)}
                      style={{
                        background: schedule.enabled ? "#10b981" : "#6b7280",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "uppercase",
                      }}
                    >
                      {schedule.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={() => onDeleteSchedule(schedule.id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        fontSize: 18,
                        cursor: "pointer",
                        padding: 4,
                      }}
                    >
                      ×
                    </button>
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
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "#2a2a38",
              color: "#e8e8f0",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
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

AutomationScheduler.propTypes = {
  schedules: PropTypes.array.isRequired,
  onCreateSchedule: PropTypes.func.isRequired,
  onUpdateSchedule: PropTypes.func.isRequired,
  onDeleteSchedule: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
