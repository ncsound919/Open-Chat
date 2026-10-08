import React from "react";
import PropTypes from "prop-types";

const MENU = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "chats", label: "Chats", icon: "💬", badgeKey: "unread" },
  { id: "agents", label: "Agents", icon: "🤖", badgeKey: "agents" },
  { id: "approvals", label: "Approvals", icon: "✅", badgeKey: "approvals" },
  { id: "stats", label: "Stats", icon: "📊" },
  { id: "work", label: "Work", icon: "📋" },
  { id: "models", label: "Models", icon: "🧠" },
  { id: "eval", label: "Model Eval", icon: "🧪" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

/**
 * Sidebar — slide-in navigation drawer (Facebook Messenger style). Replaces
 * the cryptic icon-only bottom bar with clearly labeled destinations.
 */
export function Sidebar({ open, onClose, onNavigate, unread = 0, agentCount = 0, approvalCount = 0 }) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 90,
          }}
        />
      )}
      <div
        className="safe-bottom"
        role="dialog"
        aria-label="Navigation menu"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: "min(82%, 320px)",
          background: "#10101a",
          zIndex: 100,
          transform: open ? "translateX(0)" : "translateX(-105%)",
          transition: "transform .22s ease",
          display: "flex",
          flexDirection: "column",
          boxShadow: open ? "0 0 60px rgba(0,0,0,0.6)" : "none",
        }}
      >
        <div style={{ padding: "56px 20px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f0f0f5", letterSpacing: "-0.02em" }}>
            Open Chat
          </div>
          <div style={{ fontSize: 12, color: "#555568", marginTop: 2 }}>
            Your agent command center
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px" }}>
          {MENU.map((item) => {
            const badge = item.badgeKey === "unread" ? unread : item.badgeKey === "agents" ? agentCount : item.badgeKey === "approvals" ? approvalCount : 0;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  width: "100%",
                  background: "none",
                  border: "none",
                  borderRadius: 10,
                  padding: "12px 14px",
                  cursor: "pointer",
                  color: "#e0e0ea",
                  fontSize: 15,
                  fontWeight: 600,
                  textAlign: "left",
                  transition: "background .12s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a26")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {badge > 0 && (
                  <span
                    style={{
                      background: item.badgeKey === "unread" ? "#22d3ee" : "#2c2c38",
                      color: item.badgeKey === "unread" ? "#05060a" : "#88889a",
                      borderRadius: "50%",
                      minWidth: 20,
                      height: 20,
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 5px",
                    }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}

          <div style={{ margin: "14px 14px 6px", fontSize: 11, color: "#555568", letterSpacing: "0.08em" }}>
            SHORTCUTS
          </div>
          <button
            onClick={() => onNavigate("local")}
            style={shortcutStyle}
          >
            <span style={{ fontSize: 18 }}>🔒</span>
            <span style={{ flex: 1 }}>Private Local</span>
          </button>
        </div>

        <div
          style={{
            padding: "12px 20px 20px",
            borderTop: "1px solid #1c1c28",
            fontSize: 11,
            color: "#555568",
            lineHeight: 1.5,
          }}
        >
          Private · on-device AI with Draymond orchestration
        </div>
      </div>
    </>
  );
}

const shortcutStyle = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  width: "100%",
  background: "none",
  border: "none",
  borderRadius: 10,
  padding: "12px 14px",
  cursor: "pointer",
  color: "#e0e0ea",
  fontSize: 15,
  fontWeight: 600,
  textAlign: "left",
};

Sidebar.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
  unread: PropTypes.number,
  agentCount: PropTypes.number,
  approvalCount: PropTypes.number,
};
