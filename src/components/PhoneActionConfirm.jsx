import React from "react";
import PropTypes from "prop-types";

/**
 * PhoneActionConfirm — blocking Allow/Deny sheet for mutating phone actions
 * (tap/type/open_app/swipe/press and Galaxy AI skills). Shown before an
 * on-device model or the remote worker loop drives another app, so the user
 * sees exactly what is about to happen and can decline it.
 */
export function PhoneActionConfirm({ request, onAllow, onDeny }) {
  if (!request) return null;

  const { description = "Run an action on this phone", toolName = "" } = request;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm phone action"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#15151f",
          border: "1px solid #2c2c38",
          borderRadius: 16,
          padding: 18,
          color: "#e0e0ea",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 22 }}>📱</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f5" }}>
            Allow this action?
          </span>
        </div>

        <div
          style={{
            background: "#10101a",
            border: "1px solid #22222e",
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 15,
            marginBottom: 8,
            wordBreak: "break-word",
          }}
        >
          {description}
        </div>

        {toolName && (
          <div style={{ fontSize: 12, color: "#555568", marginBottom: 16 }}>
            Tool: {toolName}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onDeny}
            autoFocus
            style={{
              flex: 1,
              background: "#1c1c28",
              border: "1px solid #2c2c38",
              borderRadius: 10,
              padding: "12px 0",
              color: "#ef4444",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Deny
          </button>
          <button
            onClick={onAllow}
            style={{
              flex: 1,
              background: "#22d3ee",
              border: "none",
              borderRadius: 10,
              padding: "12px 0",
              color: "#05060a",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

PhoneActionConfirm.propTypes = {
  request: PropTypes.shape({
    name: PropTypes.string,
    toolName: PropTypes.string,
    args: PropTypes.object,
    description: PropTypes.string,
  }),
  onAllow: PropTypes.func.isRequired,
  onDeny: PropTypes.func.isRequired,
};

export default PhoneActionConfirm;
