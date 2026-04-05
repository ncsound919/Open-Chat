import React, { useState } from "react";
import PropTypes from "prop-types";
import { uuid } from "../utils/helpers.js";

/**
 * Context Injection Interface
 * Allows users to inject custom context into conversations
 */
export function ContextManager({ channelId, contexts, onSave, onDelete, onClose }) {
  const [activeTab, setActiveTab] = useState("list");
  const [editingContext, setEditingContext] = useState(null);

  const [form, setForm] = useState({
    title: "",
    content: "",
    type: "instruction",
    priority: "normal",
  });

  const contextTypes = [
    { value: "instruction", label: "Instruction", desc: "Behavioral guidelines" },
    { value: "knowledge", label: "Knowledge", desc: "Facts and information" },
    { value: "example", label: "Example", desc: "Example conversations" },
    { value: "constraint", label: "Constraint", desc: "Rules and limitations" },
  ];

  const priorities = [
    { value: "high", label: "High", color: "#ef4444" },
    { value: "normal", label: "Normal", color: "#818cf8" },
    { value: "low", label: "Low", color: "#6b7280" },
  ];

  const handleSave = () => {
    const context = {
      id: editingContext?.id || uuid(),
      channelId,
      title: form.title.trim(),
      content: form.content.trim(),
      type: form.type,
      priority: form.priority,
      createdAt: editingContext?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    onSave(context);
    resetForm();
    setActiveTab("list");
  };

  const handleEdit = (context) => {
    setEditingContext(context);
    setForm({
      title: context.title,
      content: context.content,
      type: context.type,
      priority: context.priority,
    });
    setActiveTab("edit");
  };

  const handleDelete = (contextId) => {
    if (confirm("Are you sure you want to delete this context?")) {
      onDelete(contextId);
    }
  };

  const resetForm = () => {
    setForm({
      title: "",
      content: "",
      type: "instruction",
      priority: "normal",
    });
    setEditingContext(null);
  };

  const channelContexts = contexts.filter((c) => c.channelId === channelId);

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
          maxWidth: 800,
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
            Context Manager
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
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "0 24px",
            borderBottom: "1px solid #2a2a38",
          }}
        >
          {[
            { id: "list", label: "Context List" },
            { id: "edit", label: editingContext ? "Edit Context" : "New Context" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? "#0d0d14" : "transparent",
                border: "none",
                borderBottom:
                  activeTab === tab.id ? "2px solid #818cf8" : "2px solid transparent",
                color: activeTab === tab.id ? "#e8e8f0" : "#666680",
                padding: "12px 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
          }}
        >
          {activeTab === "list" ? (
            <div>
              {channelContexts.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#666680",
                  }}
                >
                  <p style={{ marginBottom: 16 }}>No context injections yet</p>
                  <button
                    onClick={() => setActiveTab("edit")}
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
                    Add First Context
                  </button>
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#666680" }}>
                      {channelContexts.length} context{channelContexts.length !== 1 ? "s" : ""}
                    </div>
                    <button
                      onClick={() => {
                        resetForm();
                        setActiveTab("edit");
                      }}
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
                      + Add New
                    </button>
                  </div>

                  {channelContexts
                    .sort((a, b) => {
                      const priorityOrder = { high: 0, normal: 1, low: 2 };
                      return (
                        priorityOrder[a.priority] - priorityOrder[b.priority] ||
                        b.updatedAt - a.updatedAt
                      );
                    })
                    .map((context) => (
                      <div
                        key={context.id}
                        style={{
                          background: "#0d0d14",
                          borderRadius: 10,
                          padding: "14px 16px",
                          marginBottom: 10,
                          border: "1px solid #2a2a38",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 4,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 15,
                                  fontWeight: 500,
                                  color: "#e8e8f0",
                                }}
                              >
                                {context.title}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#666680",
                                  background: "#ffffff10",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  textTransform: "capitalize",
                                }}
                              >
                                {context.type}
                              </span>
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background:
                                    priorities.find((p) => p.value === context.priority)
                                      ?.color || "#6b7280",
                                }}
                              />
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                color: "#9090a0",
                                maxHeight: 60,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {context.content}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, marginLeft: 12 }}>
                            <button
                              onClick={() => handleEdit(context)}
                              style={{
                                background: "none",
                                border: "1px solid #2a2a38",
                                borderRadius: 6,
                                padding: "6px 12px",
                                color: "#e8e8f0",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(context.id)}
                              style={{
                                background: "none",
                                border: "1px solid #ef444440",
                                borderRadius: 6,
                                padding: "6px 12px",
                                color: "#ef4444",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    fontSize: 12,
                    color: "#666680",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g., Always be concise"
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

              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    fontSize: 12,
                    color: "#666680",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Content
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Enter the context to inject..."
                  rows={8}
                  style={{
                    width: "100%",
                    background: "#0d0d14",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginBottom: 20,
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "#666680",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    style={{
                      width: "100%",
                      background: "#0d0d14",
                      border: "1px solid #2a2a38",
                      borderRadius: 8,
                      padding: "10px 12px",
                      color: "#e8e8f0",
                      fontSize: 14,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {contextTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label} - {type.desc}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "#666680",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    style={{
                      width: "100%",
                      background: "#0d0d14",
                      border: "1px solid #2a2a38",
                      borderRadius: 8,
                      padding: "10px 12px",
                      color: "#e8e8f0",
                      fontSize: 14,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {priorities.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={handleSave}
                  disabled={!form.title.trim() || !form.content.trim()}
                  style={{
                    flex: 1,
                    background:
                      form.title.trim() && form.content.trim()
                        ? "#818cf8"
                        : "#333347",
                    color: "#0d0d14",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor:
                      form.title.trim() && form.content.trim()
                        ? "pointer"
                        : "not-allowed",
                    opacity: form.title.trim() && form.content.trim() ? 1 : 0.5,
                  }}
                >
                  {editingContext ? "Update Context" : "Save Context"}
                </button>
                <button
                  onClick={() => {
                    resetForm();
                    setActiveTab("list");
                  }}
                  style={{
                    background: "none",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "10px 20px",
                    color: "#e8e8f0",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ContextManager.propTypes = {
  channelId: PropTypes.string.isRequired,
  contexts: PropTypes.array.isRequired,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
