import React, { useState } from "react";
import PropTypes from "prop-types";

/**
 * Team Management Panel
 * Manage team spaces, members, roles, and permissions
 */
export function TeamPanel({ teams, onCreateTeam, onUpdateTeam, onInviteMember, onClose }) {
  const [activeTab, setActiveTab] = useState("spaces");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const handleCreateTeam = () => {
    if (!newTeamName.trim()) return;

    onCreateTeam({
      name: newTeamName.trim(),
      createdAt: Date.now(),
      members: [],
      role: "admin",
    });

    setNewTeamName("");
    setShowCreateForm(false);
  };

  const handleInvite = (teamId) => {
    if (!inviteEmail.trim()) return;

    onInviteMember(teamId, {
      email: inviteEmail.trim(),
      role: "member",
      invitedAt: Date.now(),
      status: "pending",
    });

    setInviteEmail("");
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case "admin":
        return "#ef4444";
      case "moderator":
        return "#f59e0b";
      case "member":
        return "#10b981";
      default:
        return "#6b7280";
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
          maxWidth: 900,
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
              Team Management
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
            {["spaces", "members", "roles", "activity"].map((tab) => (
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
          {/* Team Spaces Tab */}
          {activeTab === "spaces" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 13, color: "#9090a0" }}>
                  Create and manage team spaces for collaboration
                </div>
                <button
                  onClick={() => setShowCreateForm(true)}
                  style={{
                    background: "#818cf8",
                    color: "#0d0d14",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  + New Space
                </button>
              </div>

              {/* Create Team Form */}
              {showCreateForm && (
                <div
                  style={{
                    background: "#0d0d14",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "16px",
                    marginBottom: 16,
                  }}
                >
                  <input
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="Team space name"
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
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => {
                        setShowCreateForm(false);
                        setNewTeamName("");
                      }}
                      style={{
                        background: "#2a2a38",
                        color: "#e8e8f0",
                        border: "none",
                        borderRadius: 6,
                        padding: "8px 16px",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateTeam}
                      style={{
                        background: "#818cf8",
                        color: "#0d0d14",
                        border: "none",
                        borderRadius: 6,
                        padding: "8px 16px",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}

              {/* Team List */}
              {teams.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#666680",
                  }}
                >
                  No team spaces yet. Create one to get started.
                </div>
              ) : (
                teams.map((team) => (
                  <div
                    key={team.id}
                    style={{
                      background: "#0d0d14",
                      border: "1px solid #2a2a38",
                      borderRadius: 8,
                      padding: "16px",
                      marginBottom: 12,
                      cursor: "pointer",
                    }}
                    onClick={() => setSelectedTeam(team)}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 500,
                            color: "#e8e8f0",
                            marginBottom: 4,
                          }}
                        >
                          {team.name}
                        </div>
                        <div style={{ fontSize: 12, color: "#666680" }}>
                          {team.members?.length || 0} members
                        </div>
                      </div>
                      <div
                        style={{
                          background: `${getRoleBadgeColor(team.role)}20`,
                          border: `1px solid ${getRoleBadgeColor(team.role)}`,
                          color: getRoleBadgeColor(team.role),
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {team.role}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Members Tab */}
          {activeTab === "members" && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#9090a0", marginBottom: 12 }}>
                  Invite new members to your team
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                    style={{
                      flex: 1,
                      background: "#0d0d14",
                      border: "1px solid #2a2a38",
                      borderRadius: 6,
                      padding: "10px 12px",
                      color: "#e8e8f0",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => selectedTeam && handleInvite(selectedTeam.id)}
                    disabled={!selectedTeam}
                    style={{
                      background: selectedTeam ? "#818cf8" : "#2a2a38",
                      color: selectedTeam ? "#0d0d14" : "#666680",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: selectedTeam ? "pointer" : "not-allowed",
                    }}
                  >
                    Send Invite
                  </button>
                </div>
                {!selectedTeam && (
                  <div style={{ fontSize: 11, color: "#666680", marginTop: 6 }}>
                    Select a team space first
                  </div>
                )}
              </div>

              {selectedTeam && selectedTeam.members?.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#e8e8f0",
                      marginBottom: 12,
                    }}
                  >
                    {selectedTeam.name} Members
                  </div>
                  {selectedTeam.members.map((member, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: "#0d0d14",
                        border: "1px solid #2a2a38",
                        borderRadius: 8,
                        padding: "12px 16px",
                        marginBottom: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, color: "#e8e8f0" }}>
                          {member.email}
                        </div>
                        <div style={{ fontSize: 11, color: "#666680" }}>
                          {member.status === "pending" ? "Invitation pending" : "Active"}
                        </div>
                      </div>
                      <div
                        style={{
                          background: `${getRoleBadgeColor(member.role)}20`,
                          border: `1px solid ${getRoleBadgeColor(member.role)}`,
                          color: getRoleBadgeColor(member.role),
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {member.role}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Roles Tab */}
          {activeTab === "roles" && (
            <div>
              <div style={{ fontSize: 13, color: "#9090a0", marginBottom: 16 }}>
                Configure role-based access control
              </div>

              {["admin", "moderator", "member", "guest"].map((role) => (
                <div
                  key={role}
                  style={{
                    background: "#0d0d14",
                    border: "1px solid #2a2a38",
                    borderRadius: 8,
                    padding: "16px",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 500,
                        color: "#e8e8f0",
                        textTransform: "capitalize",
                      }}
                    >
                      {role}
                    </div>
                    <div
                      style={{
                        background: `${getRoleBadgeColor(role)}20`,
                        border: `1px solid ${getRoleBadgeColor(role)}`,
                        color: getRoleBadgeColor(role),
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {getRoleBadgeColor(role)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#666680" }}>
                    {role === "admin" &&
                      "Full access to all features, can manage members and settings"}
                    {role === "moderator" &&
                      "Can manage content and invite members"}
                    {role === "member" &&
                      "Standard access to team features"}
                    {role === "guest" && "Read-only access to shared content"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Activity Tab */}
          {activeTab === "activity" && (
            <div>
              <div style={{ fontSize: 13, color: "#9090a0", marginBottom: 16 }}>
                Recent team activity
              </div>
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "#666680",
                }}
              >
                No recent activity
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

TeamPanel.propTypes = {
  teams: PropTypes.array.isRequired,
  onCreateTeam: PropTypes.func.isRequired,
  onUpdateTeam: PropTypes.func.isRequired,
  onInviteMember: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
