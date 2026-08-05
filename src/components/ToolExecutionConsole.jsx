import React, { useState } from "react";
import PropTypes from "prop-types";

/**
 * Tool Execution Console
 * Provides UI for manual skill/tool invocation with parameter input
 */
export function ToolExecutionConsole({ onExecute, onClose }) {
  const [toolName, setToolName] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [error, setError] = useState("");

  const handleExecute = () => {
    setError("");

    if (!toolName.trim()) {
      setError("Tool name is required");
      return;
    }

    try {
      const parsed = JSON.parse(parameters);
      onExecute(toolName.trim(), parsed);
      // Clear form after successful execution
      setToolName("");
      setParameters("{}");
    } catch (e) {
      setError(`Invalid JSON: ${e.message}`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleExecute();
    }
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
          maxWidth: 600,
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
              Execute Tool
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
        </div>

        {/* Form */}
        <div style={{ padding: "24px" }}>
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 500,
                color: "#9090a0",
                marginBottom: 8,
              }}
            >
              Tool Name
            </label>
            <input
              type="text"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., file_read, web_search, calculate"
              style={{
                width: "100%",
                background: "#0d0d14",
                border: "1px solid #2a2a38",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#e8e8f0",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 500,
                color: "#9090a0",
                marginBottom: 8,
              }}
            >
              Parameters (JSON)
            </label>
            <textarea
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='{"path": "/home/user/file.txt"}'
              style={{
                width: "100%",
                background: "#0d0d14",
                border: "1px solid #2a2a38",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#e8e8f0",
                fontSize: 13,
                fontFamily: "monospace",
                outline: "none",
                minHeight: 120,
                resize: "vertical",
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: "#666680",
                marginTop: 6,
              }}
            >
              Cmd/Ctrl + Enter to execute
            </div>
          </div>

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

          <div
            style={{
              display: "flex",
              gap: 12,
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
              Cancel
            </button>
            <button
              onClick={handleExecute}
              style={{
                background: "#818cf8",
                color: "#0d0d14",
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Execute
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

ToolExecutionConsole.propTypes = {
  onExecute: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
