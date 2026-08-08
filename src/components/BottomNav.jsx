import React from "react";
import PropTypes from "prop-types";

const TABS = [
  { id: "chats", label: "Chats", icon: "💬" },
  { id: "agents", label: "Agents", icon: "🤖" },
  { id: "work", label: "Work", icon: "📋" },
  { id: "models", label: "Models", icon: "🧠" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

/**
 * BottomNav — primary navigation for the inbox level of the app.
 */
export function BottomNav({ tab, onChange, unread }) {
  return (
    <div
      className="safe-bottom"
      style={{
        display: "flex",
        borderTop: "1px solid #1c1c28",
        background: "#0f0f16",
        paddingBottom: 8,
        paddingTop: 6,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "6px 0 2px",
              color: active ? "#22d3ee" : "#666679",
              position: "relative",
            }}
            aria-pressed={active}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>
              {t.label}
            </span>
            {t.id === "chats" && unread > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: "24%",
                  background: "#ef4444",
                  color: "#fff",
                  borderRadius: "50%",
                  minWidth: 16,
                  height: 16,
                  fontSize: 9,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 3px",
                }}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

BottomNav.propTypes = {
  tab: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  unread: PropTypes.number,
};
