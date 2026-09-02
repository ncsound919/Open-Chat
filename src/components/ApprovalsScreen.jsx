import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { BotAvatar } from "./BotAvatar.jsx";
import {
  loadResolvedApprovals,
  saveResolvedApprovals,
} from "../utils/storage.js";

const STATUS_COLOR = {
  connected: "#22c55e",
  connecting: "#f59e0b",
  disconnected: "#555568",
  error: "#ef4444",
};

const card = {
  background: "#15151f",
  border: "1px solid #22222e",
  borderRadius: 12,
  padding: "12px 14px",
  marginBottom: 10,
};

const menuBtn = {
  background: "#1c1c28",
  border: "1px solid #2c2c38",
  borderRadius: 10,
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
  cursor: "pointer",
  fontSize: 16,
};

const pill = (color, label) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 10,
      fontWeight: 700,
      color,
      background: `${color}1c`,
      borderRadius: 6,
      padding: "2px 8px",
      whiteSpace: "nowrap",
    }}
  >
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
      }}
    />
    {label}
  </span>
);

/**
 * Collect every pending approval surface from ntfy bot chats — messages that
 * carry ntfy action buttons (Draymond's human-in-the-loop approve/reject).
 */
export function collectApprovalItems(bots, history) {
  const items = [];
  for (const bot of bots || []) {
    if (bot.protocol !== "ntfy") continue;
    for (const msg of history?.[bot.id] || []) {
      if (!Array.isArray(msg.actions) || msg.actions.length === 0) continue;
      const key = msg.ntfyId || msg.id || `${bot.id}-${msg.time}`;
      items.push({
        key,
        botId: bot.id,
        botName: bot.name || bot.id,
        color: bot.color,
        text: msg.text || "",
        time: msg.time || Date.now(),
        actions: msg.actions,
      });
    }
  }
  // Newest first, stable per key.
  return items.sort((a, b) => b.time - a.time);
}

/**
 * Approvals — the human-in-the-loop inbox. Every agent action that needs
 * approval (Draymond review gates arrive via ntfy with Approve/Reject buttons)
 * lands here. Resolved decisions are persisted locally so they don't reappear.
 */
export function ApprovalsScreen({ bots = [], history = {}, onExecute, onOpenMenu }) {
  const [resolved, setResolved] = useState(() => loadResolvedApprovals());
  const [busyKey, setBusyKey] = useState(null);
  const [errors, setErrors] = useState({});

  const items = useMemo(() => collectApprovalItems(bots, history), [bots, history]);
  const pending = items.filter((i) => !resolved[i.key]);
  const resolvedItems = items.filter((i) => resolved[i.key]);

  const runAction = async (item, action) => {
    if (busyKey) return;
    setBusyKey(`${item.key}:${action.action}:${action.id || ""}`);
    setErrors((prev) => ({ ...prev, [item.key]: undefined }));
    try {
      const res = await onExecute(item.botId, action);
      if (res?.ok) {
        const decision = String(action.label || action.action || "approved");
        setResolved((prev) => {
          const next = { ...prev, [item.key]: { decision, at: Date.now() } };
          saveResolvedApprovals(next);
          return next;
        });
      } else {
        setErrors((prev) => ({ ...prev, [item.key]: res?.error || "Action failed" }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [item.key]: err?.message || "Action failed",
      }));
    } finally {
      setBusyKey(null);
    }
  };

  const renderCard = (item, isPending) => {
    const decision = resolved[item.key];
    const statusColor = STATUS_COLOR.connected;
    return (
      <div key={item.key} style={{ ...card, background: "#13141d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BotAvatar bot={{ color: item.color }} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#f0f0f5" }}>
              {item.botName}
            </div>
            <div style={{ fontSize: 11, color: "#555568", marginTop: 1 }}>
              {new Date(item.time).toLocaleString()}
            </div>
          </div>
          {isPending
            ? pill(statusColor, "pending")
            : pill("#22d3ee", decision?.decision || "resolved")}
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#c9c9d8",
            lineHeight: 1.5,
            marginTop: 10,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {item.text}
        </div>

        {isPending && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {item.actions.slice(0, 3).map((action, i) => {
              const isApprove = /approve|allow|✓|accept/i.test(String(action.label || action.action || ""));
              const isDeny = /deny|reject|✕|✗/i.test(String(action.label || action.action || ""));
              const key = `${item.key}:${action.action}:${action.id || ""}:${i}`;
              const busy = busyKey === key;
              const bg = isApprove ? "#0f2b20" : isDeny ? "#2d1a1a" : "#ffffff12";
              const fg = isApprove ? "#34d399" : isDeny ? "#ef4444" : "#e8e8f0";
              return (
                <button
                  key={key}
                  disabled={busy || !!busyKey}
                  onClick={() => runAction(item, action)}
                  style={{
                    background: bg,
                    border: `1px solid ${fg}60`,
                    borderRadius: 8,
                    padding: "6px 14px",
                    color: fg,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: busy || busyKey ? "default" : "pointer",
                    opacity: busy || busyKey ? 0.6 : 1,
                    fontFamily: "inherit",
                  }}
                >
                  {busy ? "Working…" : String(action.label || action.action || "Run")}
                </button>
              );
            })}
          </div>
        )}

        {errors[item.key] && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "#ef4444",
              background: "#ef444418",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            {errors[item.key]}
          </div>
        )}
      </div>
    );
  };

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
          }}
        >
          <button onClick={onOpenMenu} aria-label="Open navigation menu" style={menuBtn}>
            <span style={{ fontSize: 20 }}>☰</span>
          </button>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#f0f0f5",
              letterSpacing: "-0.02em",
            }}
          >
            Approvals
          </h1>
          <div style={{ width: 40 }} />
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {pill("#f59e0b", `${pending.length} pending`)}
          {pill("#555568", `${resolvedItems.length} resolved`)}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 28px" }}>
        {items.length === 0 ? (
          <div style={card}>No approval requests yet.</div>
        ) : (
          <>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "#555568",
                margin: "14px 0 8px",
              }}
            >
              PENDING
            </div>
            {pending.length === 0 ? (
              <div style={card}>All caught up — nothing waiting for you.</div>
            ) : (
              pending.map((i) => renderCard(i, true))
            )}

            {resolvedItems.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: "#555568",
                    margin: "14px 0 8px",
                  }}
                >
                  RESOLVED
                </div>
                {resolvedItems.map((i) => renderCard(i, false))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

ApprovalsScreen.propTypes = {
  bots: PropTypes.array,
  history: PropTypes.object,
  onExecute: PropTypes.func.isRequired,
  onOpenMenu: PropTypes.func.isRequired,
};
