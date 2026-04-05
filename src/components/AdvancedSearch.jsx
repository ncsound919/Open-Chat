import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { searchMessages } from "../utils/indexedDB.js";
import { SearchIcon } from "./icons/Icons.jsx";

/**
 * Advanced Search Component
 * Provides full-text search with filters for date, agent, and keywords
 */
export function AdvancedSearch({ bots, onSelectMessage, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    agentId: "all",
    dateFrom: "",
    dateTo: "",
  });

  useEffect(() => {
    const performSearch = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const searchResults = await searchMessages(
          query,
          filters.agentId === "all" ? null : filters.agentId,
          100
        );

        // Apply date filters
        let filtered = searchResults;
        if (filters.dateFrom) {
          const fromDate = new Date(filters.dateFrom).getTime();
          filtered = filtered.filter((msg) => msg.timestamp >= fromDate);
        }
        if (filters.dateTo) {
          const toDate = new Date(filters.dateTo).getTime() + 86400000; // +1 day
          filtered = filtered.filter((msg) => msg.timestamp < toDate);
        }

        setResults(filtered);
      } catch (error) {
        console.error("Search failed:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, filters]);

  const highlightQuery = (text) => {
    if (!query.trim() || !text) return text;

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Escape regex metacharacters in each term to prevent ReDoS / incorrect matches
    const escapedTerms = terms.map((t) =>
      t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );

    const regex = new RegExp(`(${escapedTerms.join("|")})`, "gi");

    // Split on captured matches: odd indices are matches, even indices are plain text
    const parts = text.split(regex);
    return parts.map((part, i) =>
      i % 2 === 1 ? <mark key={`${i}-${part}`}>{part}</mark> : part
    );
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  const getBotById = (channelId) => {
    return bots.find((b) => b.id === channelId);
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
          maxWidth: 900,
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
              Advanced Search
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

          {/* Search Input */}
          <div style={{ position: "relative", marginBottom: 16 }}>
            <div
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#666680",
              }}
            >
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search messages..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                background: "#0d0d14",
                border: "1px solid #2a2a38",
                borderRadius: 10,
                padding: "12px 12px 12px 40px",
                color: "#e8e8f0",
                fontSize: 15,
                outline: "none",
              }}
            />
          </div>

          {/* Filters */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
            }}
          >
            <div>
              <label
                style={{
                  fontSize: 11,
                  color: "#666680",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Agent
              </label>
              <select
                value={filters.agentId}
                onChange={(e) =>
                  setFilters({ ...filters, agentId: e.target.value })
                }
                style={{
                  width: "100%",
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 6,
                  padding: "6px 8px",
                  color: "#e8e8f0",
                  fontSize: 13,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">All Agents</option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.avatar} {bot.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: "#666680",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                From Date
              </label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters({ ...filters, dateFrom: e.target.value })
                }
                style={{
                  width: "100%",
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 6,
                  padding: "6px 8px",
                  color: "#e8e8f0",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: "#666680",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                To Date
              </label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters({ ...filters, dateTo: e.target.value })
                }
                style={{
                  width: "100%",
                  background: "#0d0d14",
                  border: "1px solid #2a2a38",
                  borderRadius: 6,
                  padding: "6px 8px",
                  color: "#e8e8f0",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>
          </div>
        </div>

        {/* Results */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 24px",
          }}
        >
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#666680",
              }}
            >
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#666680",
              }}
            >
              {query.trim()
                ? "No messages found"
                : "Enter a search query to find messages"}
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "#666680",
                  marginBottom: 12,
                }}
              >
                {results.length} result{results.length !== 1 ? "s" : ""} found
              </div>

              {results.map((msg) => {
                const bot = getBotById(msg.channelId);
                return (
                  <div
                    key={msg.id}
                    onClick={() => onSelectMessage(msg)}
                    style={{
                      background: "#0d0d14",
                      borderRadius: 10,
                      padding: "12px 14px",
                      marginBottom: 10,
                      border: "1px solid #2a2a38",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#1a1a24")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "#0d0d14")
                    }
                  >
                    {/* Bot Info & Date */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {bot && (
                          <>
                            <span style={{ fontSize: 14 }}>{bot.avatar}</span>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: "#e8e8f0",
                              }}
                            >
                              {bot.name}
                            </span>
                          </>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: "#666680" }}>
                        {formatDate(msg.timestamp)}
                      </span>
                    </div>

                    {/* Message Preview with Highlights */}
                    <div
                      style={{
                        fontSize: 14,
                        color: "#b0b0c0",
                        lineHeight: 1.5,
                        maxHeight: 100,
                        overflow: "hidden",
                      }}
                    >
                      {highlightQuery(msg.text?.substring(0, 300) || "")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #2a2a38",
            textAlign: "right",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "#818cf8",
              color: "#0d0d14",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      <style>
        {`
          mark {
            background: #818cf840;
            color: #e8e8f0;
            padding: 1px 3px;
            border-radius: 3px;
          }
        `}
      </style>
    </div>
  );
}

AdvancedSearch.propTypes = {
  bots: PropTypes.array.isRequired,
  onSelectMessage: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
