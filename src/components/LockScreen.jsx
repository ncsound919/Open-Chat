import React, { useState } from "react";
import PropTypes from "prop-types";

const inputStyle = {
  width: "100%",
  background: "#1c1c28",
  border: "1px solid #2c2c38",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#f0f0f5",
  fontSize: 15,
  outline: "none",
  fontFamily: "inherit",
};

/**
 * LockScreen — shown at boot when local data is encrypted. Asks for the
 * passphrase before the app can read chat history or bot config.
 */
export function LockScreen({ onUnlock }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || !passphrase) return;
    setBusy(true);
    setError("");
    const ok = await onUnlock(passphrase);
    if (!ok) {
      setError("Wrong passphrase. Try again.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#0d0d14",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 200,
      }}
    >
      <form
        onSubmit={submit}
        style={{ width: "100%", maxWidth: 340, textAlign: "center" }}
        data-testid="lock-screen"
      >
        <div style={{ fontSize: 40, marginBottom: 10 }} aria-hidden="true">🔒</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f0f0f5", letterSpacing: "-0.02em" }}>
          Open Chat
        </div>
        <div style={{ fontSize: 13, color: "#666679", marginTop: 6, lineHeight: 1.5 }}>
          Local data is encrypted. Enter your passphrase to continue.
        </div>

        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          aria-label="Passphrase"
          style={{ ...inputStyle, marginTop: 20 }}
          disabled={busy}
        />

        {error && (
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
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !passphrase}
          style={{
            width: "100%",
            marginTop: 12,
            background: "#22d3ee",
            color: "#05060a",
            border: "none",
            borderRadius: 10,
            padding: "12px",
            fontSize: 15,
            fontWeight: 700,
            cursor: busy ? "default" : "pointer",
            opacity: busy || !passphrase ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

LockScreen.propTypes = {
  onUnlock: PropTypes.func.isRequired,
};
