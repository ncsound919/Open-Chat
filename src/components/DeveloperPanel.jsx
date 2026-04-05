import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

/**
 * Developer Panel
 * Advanced debugging and configuration panel for Dev mode
 */
export function DeveloperPanel({ bot, onUpdateBot, onClose }) {
  const [activeTab, setActiveTab] = useState("config");
  const [configJson, setConfigJson] = useState(JSON.stringify(bot, null, 2));
  const [configError, setConfigError] = useState("");
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleSaveConfig = () => {
    setConfigError("");
    try {
      const parsed = JSON.parse(configJson);

      // Validate required fields
      if (!parsed.id || !parsed.name || !parsed.protocol) {
        setConfigError("Missing required fields: id, name, or protocol");
        return;
      }

      onUpdateBot(parsed);
      setConfigError("");
    } catch (e) {
      setConfigError(`Invalid JSON: ${e.message}`);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const getLogColor = (level) => {
    switch (level) {
      case "error":
        return "#ef4444";
      case "warn":
        return "#f59e0b";
      case "info":
        return "#3b82f6";
      case "debug":
        return "#6b7280";
      default:
        return "#9090a0";
    }
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
          maxWidth: 1000,
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
              Developer Panel
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

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8 }}>
            {["config", "logs", "models", "webhooks"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: activeTab === tab ? "#818cf8" : "#2a2a38",
                  color: activeTab === tab ? "#0d0d14" : "#e8e8f0",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {tab}
              </button>
            ))}
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
          {/* Config Tab */}
          {activeTab === "config" && (
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "#9090a0",
                  marginBottom: 12,
                }}
              >
                Edit the bot configuration as JSON. Changes will be applied
                immediately.
              </div>
              <textarea
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "12px",
                  color: "#e8e8f0",
                  fontSize: 13,
                  fontFamily: "monospace",
                  outline: "none",
                  minHeight: 400,
                  resize: "vertical",
                }}
              />
              {configError && (
                <div
                  style={{
                    fontSize: 13,
                    color: "#ef4444",
                    background: "#ef444420",
                    padding: "10px 12px",
                    borderRadius: 6,
                    marginTop: 12,
                    border: "1px solid #ef444440",
                  }}
                >
                  {configError}
                </div>
              )}
              <button
                onClick={handleSaveConfig}
                style={{
                  background: "#818cf8",
                  color: "#0d0d14",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  marginTop: 16,
                }}
              >
                Save Configuration
              </button>
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === "logs" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <label
                  style={{
                    fontSize: 13,
                    color: "#9090a0",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  Auto-scroll
                </label>
                <button
                  onClick={clearLogs}
                  style={{
                    background: "#2a2a38",
                    color: "#e8e8f0",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Clear Logs
                </button>
              </div>
              <div
                style={{
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "12px",
                  minHeight: 400,
                  maxHeight: 400,
                  overflowY: "auto",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {logs.length === 0 ? (
                  <div style={{ color: "#666680", textAlign: "center", paddingTop: 20 }}>
                    No logs yet. Connect to an agent to see live logs.
                  </div>
                ) : (
                  logs.map((log, idx) => (
                    <div
                      key={idx}
                      style={{
                        marginBottom: 6,
                        color: getLogColor(log.level),
                      }}
                    >
                      <span style={{ color: "#666680" }}>[{log.timestamp}]</span>{" "}
                      <span style={{ fontWeight: 600 }}>
                        {log.level.toUpperCase()}:
                      </span>{" "}
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* Models Tab */}
          {activeTab === "models" && (
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "#9090a0",
                  marginBottom: 16,
                }}
              >
                Model switching and configuration
              </div>
              <div
                style={{
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "16px",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#e8e8f0",
                    marginBottom: 8,
                  }}
                >
                  Default Model
                </label>
                <select
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "10px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  <option>claude-3-5-sonnet-20241022</option>
                  <option>claude-3-opus-20240229</option>
                  <option>gpt-4-turbo</option>
                  <option>gpt-4o</option>
                  <option>gemini-1.5-pro</option>
                  <option>llama-3-70b</option>
                  <option>custom</option>
                </select>

                <div style={{ marginTop: 16 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#e8e8f0",
                      marginBottom: 8,
                    }}
                  >
                    Temperature
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    defaultValue="1.0"
                    style={{
                      width: "100%",
                    }}
                  />
                </div>

                <div style={{ marginTop: 16 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#e8e8f0",
                      marginBottom: 8,
                    }}
                  >
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    defaultValue="4096"
                    style={{
                      width: "100%",
                      background: "#1c1c28",
                      border: "1px solid #2a2a38",
                      borderRadius: 6,
                      padding: "10px 12px",
                      color: "#e8e8f0",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Webhooks Tab */}
          {activeTab === "webhooks" && (
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "#9090a0",
                  marginBottom: 16,
                }}
              >
                Test webhooks and API endpoints
              </div>
              <div
                style={{
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "16px",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#e8e8f0",
                    marginBottom: 8,
                  }}
                >
                  Webhook URL
                </label>
                <input
                  type="text"
                  placeholder="http://localhost:8000/webhook"
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "10px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                    marginBottom: 12,
                  }}
                />

                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#e8e8f0",
                    marginBottom: 8,
                  }}
                >
                  Payload (JSON)
                </label>
                <textarea
                  placeholder='{"event": "test", "data": {}}'
                  style={{
                    width: "100%",
                    background: "#1c1c28",
                    border: "1px solid #2a2a38",
                    borderRadius: 6,
                    padding: "10px 12px",
                    color: "#e8e8f0",
                    fontSize: 13,
                    fontFamily: "monospace",
                    outline: "none",
                    minHeight: 150,
                    resize: "vertical",
                  }}
                />

                <button
                  style={{
                    background: "#818cf8",
                    color: "#0d0d14",
                    border: "none",
                    borderRadius: 6,
                    padding: "10px 20px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    marginTop: 12,
                  }}
                >
                  Send Test Request
                </button>
              </div>
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

DeveloperPanel.propTypes = {
  bot: PropTypes.object.isRequired,
  onUpdateBot: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
