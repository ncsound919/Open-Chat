import React, { useState } from "react";
import PropTypes from "prop-types";

/**
 * Workflow Builder Component
 * Visual multi-step workflow builder with event triggers, retry logic, and parallel execution
 */
export function WorkflowBuilder({ workflow, onSave, onCancel }) {
  const [workflowState, setWorkflowState] = useState(
    workflow || {
      id: Date.now().toString(),
      name: "",
      description: "",
      trigger: {
        type: "schedule", // schedule | event | manual
        config: {},
      },
      steps: [],
      retryPolicy: {
        enabled: false,
        maxRetries: 3,
        backoffMultiplier: 2,
        initialDelayMs: 1000,
      },
      parallelExecution: false,
      enabled: true,
    }
  );

  const [error, setError] = useState("");

  // Trigger types
  const triggerTypes = [
    { value: "schedule", label: "Schedule (Cron)" },
    { value: "event", label: "Event Trigger" },
    { value: "manual", label: "Manual Execution" },
  ];

  // Event types for event triggers
  const eventTypes = [
    { value: "message_received", label: "Message Received" },
    { value: "bot_connected", label: "Bot Connected" },
    { value: "bot_disconnected", label: "Bot Disconnected" },
    { value: "tool_executed", label: "Tool Executed" },
    { value: "webhook", label: "Webhook Received" },
  ];

  // Action types for workflow steps
  const actionTypes = [
    { value: "send_message", label: "Send Message" },
    { value: "execute_tool", label: "Execute Tool" },
    { value: "wait", label: "Wait/Delay" },
    { value: "condition", label: "Conditional Branch" },
    { value: "webhook", label: "Call Webhook" },
    { value: "subagent", label: "Spawn Subagent" },
  ];

  const updateWorkflow = (updates) => {
    setWorkflowState({ ...workflowState, ...updates });
  };

  const updateTrigger = (updates) => {
    setWorkflowState({
      ...workflowState,
      trigger: { ...workflowState.trigger, ...updates },
    });
  };

  const updateTriggerConfig = (key, value) => {
    setWorkflowState({
      ...workflowState,
      trigger: {
        ...workflowState.trigger,
        config: { ...workflowState.trigger.config, [key]: value },
      },
    });
  };

  const updateRetryPolicy = (updates) => {
    setWorkflowState({
      ...workflowState,
      retryPolicy: { ...workflowState.retryPolicy, ...updates },
    });
  };

  const addStep = () => {
    const newStep = {
      id: Date.now().toString(),
      type: "send_message",
      config: {},
      continueOnError: false,
    };
    setWorkflowState({
      ...workflowState,
      steps: [...workflowState.steps, newStep],
    });
  };

  const updateStep = (stepId, updates) => {
    setWorkflowState({
      ...workflowState,
      steps: workflowState.steps.map((step) =>
        step.id === stepId ? { ...step, ...updates } : step
      ),
    });
  };

  const deleteStep = (stepId) => {
    setWorkflowState({
      ...workflowState,
      steps: workflowState.steps.filter((step) => step.id !== stepId),
    });
  };

  const moveStep = (stepId, direction) => {
    const index = workflowState.steps.findIndex((s) => s.id === stepId);
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === workflowState.steps.length - 1)
    ) {
      return;
    }
    const newSteps = [...workflowState.steps];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    setWorkflowState({ ...workflowState, steps: newSteps });
  };

  const handleSave = () => {
    setError("");

    if (!workflowState.name.trim()) {
      setError("Workflow name is required");
      return;
    }

    if (workflowState.steps.length === 0) {
      setError("Workflow must have at least one step");
      return;
    }

    // Validate trigger configuration
    if (workflowState.trigger.type === "schedule" && !workflowState.trigger.config.cronExpression) {
      setError("Schedule trigger requires a cron expression");
      return;
    }

    if (workflowState.trigger.type === "event" && !workflowState.trigger.config.eventType) {
      setError("Event trigger requires an event type");
      return;
    }

    onSave(workflowState);
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
      onClick={onCancel}
    >
      <div
        style={{
          background: "#1c1c28",
          borderRadius: 16,
          width: "95%",
          maxWidth: 1000,
          maxHeight: "90vh",
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
              {workflow ? "Edit Workflow" : "Create Workflow"}
            </h2>
            <button
              onClick={onCancel}
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
            Build multi-step automation workflows with triggers, actions, and error handling
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
          {/* Basic Info */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e8f0", marginBottom: 12 }}>
              Workflow Details
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Workflow Name
                </label>
                <input
                  type="text"
                  value={workflowState.name}
                  onChange={(e) => updateWorkflow({ name: e.target.value })}
                  placeholder="Daily backup workflow"
                  style={{
                    width: "100%",
                    background: "#0d0d14",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={workflowState.description}
                  onChange={(e) => updateWorkflow({ description: e.target.value })}
                  placeholder="What does this workflow do?"
                  style={{
                    width: "100%",
                    background: "#0d0d14",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Trigger Configuration */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e8f0", marginBottom: 12 }}>
              Trigger
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9090a0",
                    marginBottom: 6,
                  }}
                >
                  Trigger Type
                </label>
                <select
                  value={workflowState.trigger.type}
                  onChange={(e) => updateTrigger({ type: e.target.value })}
                  style={{
                    width: "100%",
                    background: "#0d0d14",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {triggerTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Schedule trigger config */}
              {workflowState.trigger.type === "schedule" && (
                <div>
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
                    value={workflowState.trigger.config.cronExpression || "0 0 * * *"}
                    onChange={(e) => updateTriggerConfig("cronExpression", e.target.value)}
                    style={{
                      width: "100%",
                      background: "#0d0d14",
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
              )}

              {/* Event trigger config */}
              {workflowState.trigger.type === "event" && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#9090a0",
                      marginBottom: 6,
                    }}
                  >
                    Event Type
                  </label>
                  <select
                    value={workflowState.trigger.config.eventType || ""}
                    onChange={(e) => updateTriggerConfig("eventType", e.target.value)}
                    style={{
                      width: "100%",
                      background: "#0d0d14",
                      border: "1px solid #2a2a38",
                      borderRadius: 6,
                      padding: "8px 12px",
                      color: "#e8e8f0",
                      fontSize: 14,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">Select an event</option>
                    {eventTypes.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Execution Options */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e8f0", marginBottom: 12 }}>
              Execution Options
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  color: "#e8e8f0",
                }}
              >
                <input
                  type="checkbox"
                  checked={workflowState.parallelExecution}
                  onChange={(e) => updateWorkflow({ parallelExecution: e.target.checked })}
                  style={{ cursor: "pointer" }}
                />
                Run steps in parallel (when possible)
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  color: "#e8e8f0",
                }}
              >
                <input
                  type="checkbox"
                  checked={workflowState.retryPolicy.enabled}
                  onChange={(e) =>
                    updateRetryPolicy({ enabled: e.target.checked })
                  }
                  style={{ cursor: "pointer" }}
                />
                Enable retry on failure
              </label>
            </div>

            {/* Retry Policy Config */}
            {workflowState.retryPolicy.enabled && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 6,
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "1fr 1fr",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#9090a0",
                      marginBottom: 6,
                    }}
                  >
                    Max Retries
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={workflowState.retryPolicy.maxRetries}
                    onChange={(e) =>
                      updateRetryPolicy({ maxRetries: parseInt(e.target.value) })
                    }
                    style={{
                      width: "100%",
                      background: "#1c1c28",
                      border: "1px solid #2a2a38",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "#e8e8f0",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#9090a0",
                      marginBottom: 6,
                    }}
                  >
                    Initial Delay (ms)
                  </label>
                  <input
                    type="number"
                    min="100"
                    max="10000"
                    step="100"
                    value={workflowState.retryPolicy.initialDelayMs}
                    onChange={(e) =>
                      updateRetryPolicy({ initialDelayMs: parseInt(e.target.value) })
                    }
                    style={{
                      width: "100%",
                      background: "#1c1c28",
                      border: "1px solid #2a2a38",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "#e8e8f0",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Workflow Steps */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e8f0" }}>
                Workflow Steps
              </div>
              <button
                onClick={addStep}
                style={{
                  background: "#818cf8",
                  color: "#0d0d14",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                + Add Step
              </button>
            </div>

            {workflowState.steps.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 20px",
                  color: "#666680",
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                }}
              >
                No steps yet. Add a step to build your workflow.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {workflowState.steps.map((step, index) => (
                  <div
                    key={step.id}
                    style={{
                      background: "#0d0d14",
                      border: "1px solid #2a2a38",
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          background: "#2a2a38",
                          color: "#9090a0",
                          borderRadius: "50%",
                          width: 24,
                          height: 24,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {index + 1}
                      </div>
                      <select
                        value={step.type}
                        onChange={(e) => updateStep(step.id, { type: e.target.value })}
                        style={{
                          flex: 1,
                          background: "#1c1c28",
                          border: "1px solid #2a2a38",
                          borderRadius: 6,
                          padding: "6px 10px",
                          color: "#e8e8f0",
                          fontSize: 13,
                          outline: "none",
                          cursor: "pointer",
                        }}
                      >
                        {actionTypes.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => moveStep(step.id, "up")}
                          disabled={index === 0}
                          style={{
                            background: "none",
                            border: "1px solid #2a2a38",
                            borderRadius: 4,
                            color: index === 0 ? "#666680" : "#9090a0",
                            fontSize: 16,
                            cursor: index === 0 ? "not-allowed" : "pointer",
                            padding: "2px 6px",
                          }}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveStep(step.id, "down")}
                          disabled={index === workflowState.steps.length - 1}
                          style={{
                            background: "none",
                            border: "1px solid #2a2a38",
                            borderRadius: 4,
                            color:
                              index === workflowState.steps.length - 1
                                ? "#666680"
                                : "#9090a0",
                            fontSize: 16,
                            cursor:
                              index === workflowState.steps.length - 1
                                ? "not-allowed"
                                : "pointer",
                            padding: "2px 6px",
                          }}
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => deleteStep(step.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            fontSize: 16,
                            cursor: "pointer",
                            padding: "2px 6px",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        fontSize: 12,
                        color: "#9090a0",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={step.continueOnError}
                        onChange={(e) =>
                          updateStep(step.id, { continueOnError: e.target.checked })
                        }
                        style={{ cursor: "pointer" }}
                      />
                      Continue workflow on error
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div
              style={{
                fontSize: 13,
                color: "#ef4444",
                background: "#ef444420",
                padding: "10px 12px",
                borderRadius: 6,
                marginBottom: 16,
                border: "1px solid #ef444440",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #2a2a38",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            onClick={onCancel}
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
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              background: "#818cf8",
              color: "#0d0d14",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Save Workflow
          </button>
        </div>
      </div>
    </div>
  );
}

WorkflowBuilder.propTypes = {
  workflow: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
