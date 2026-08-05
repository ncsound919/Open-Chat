import React from "react";
import PropTypes from "prop-types";
import { BackIcon } from "./icons/Icons.jsx";

export function SearchResults({ query, results, bots, onSelect, onBack }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#05060a",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: "1px solid rgba(34,211,238,0.14)",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#22d3ee",
            padding: 4,
          }}
        >
          <BackIcon />
        </button>
        <span style={{ color: "#f6f7f9", fontWeight: 600 }}>
          Messages matching &ldquo;{query}&rdquo;
        </span>
        <span style={{ color: "#22d3ee", fontSize: 13, marginLeft: "auto" }}>
          {results.length} result{results.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {results.length === 0 ? (
          <div style={{ color: "#8b8b9e", textAlign: "center", paddingTop: 40 }}>
            No messages match this search.
          </div>
        ) : (
          results.map((r, i) => {
            const name = bots.find((b) => b.id === r.botId)?.name || r.botId;
            return (
              <button
                key={`${r.botId}-${i}`}
                onClick={() => onSelect(r.botId)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "rgba(20,25,36,0.72)",
                  border: "1px solid rgba(34,211,238,0.14)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  marginBottom: 8,
                  cursor: "pointer",
                  color: "#f6f7f9",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 11, color: "#22d3ee", marginBottom: 3 }}>
                  {name}
                  {r.time ? ` · ${new Date(r.time).toLocaleString()}` : ""}
                </div>
                <div style={{ fontSize: 14, color: "#e8e8f0" }}>
                  {r.message.text}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

SearchResults.propTypes = {
  query: PropTypes.string,
  results: PropTypes.array,
  bots: PropTypes.array,
  onSelect: PropTypes.func,
  onBack: PropTypes.func,
};

export default SearchResults;
