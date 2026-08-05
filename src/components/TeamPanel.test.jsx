import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamPanel } from "./TeamPanel.jsx";

const teams = [
  {
    id: "t1",
    name: "Alpha",
    role: "admin",
    members: [{ email: "a@x.com", role: "moderator", status: "active" }],
  },
  { id: "t2", name: "Beta", role: "member", members: [] },
];

describe("TeamPanel spaces", () => {
  it("lists teams with member counts and role badges", () => {
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Team Management" })).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("1 members")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("0 members")).toBeInTheDocument();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("shows the empty state when there are no teams", () => {
    render(<TeamPanel teams={[]} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No team spaces yet. Create one to get started.")).toBeInTheDocument();
  });

  it("creates a team from the new-space form", async () => {
    const onCreateTeam = vi.fn();
    const user = userEvent.setup();
    render(<TeamPanel teams={[]} onCreateTeam={onCreateTeam} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ New Space" }));
    await user.type(screen.getByPlaceholderText("Team space name"), "Gamma");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateTeam).toHaveBeenCalledWith({
      name: "Gamma",
      createdAt: expect.any(Number),
      members: [],
      role: "admin",
    });
  });

  it("does not create a team with an empty name", async () => {
    const onCreateTeam = vi.fn();
    const user = userEvent.setup();
    render(<TeamPanel teams={[]} onCreateTeam={onCreateTeam} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ New Space" }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreateTeam).not.toHaveBeenCalled();
  });

  it("cancels the new-space form", async () => {
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ New Space" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Team space name")).not.toBeInTheDocument();
  });

  it("selects a team when a space is clicked", async () => {
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByText("Alpha"));
    await user.click(screen.getByRole("button", { name: "members" }));
    expect(screen.getByText("Alpha Members")).toBeInTheDocument();
  });
});

describe("TeamPanel members", () => {
  it("invites a member for the selected team", async () => {
    const onInviteMember = vi.fn();
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={onInviteMember} onClose={vi.fn()} />);
    await user.click(screen.getByText("Alpha"));
    await user.click(screen.getByRole("button", { name: "members" }));
    await user.type(screen.getByPlaceholderText("email@example.com"), "b@x.com");
    await user.click(screen.getByRole("button", { name: "Send Invite" }));

    expect(onInviteMember).toHaveBeenCalledWith("t1", {
      email: "b@x.com",
      role: "member",
      invitedAt: expect.any(Number),
      status: "pending",
    });
  });

  it("disables the invite button before a team is selected", async () => {
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "members" }));
    expect(screen.getByRole("button", { name: "Send Invite" })).toBeDisabled();
    expect(screen.getByText("Select a team space first")).toBeInTheDocument();
  });

  it("does not invite when the email is empty", async () => {
    const onInviteMember = vi.fn();
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={onInviteMember} onClose={vi.fn()} />);
    await user.click(screen.getByText("Alpha"));
    await user.click(screen.getByRole("button", { name: "members" }));
    await user.click(screen.getByRole("button", { name: "Send Invite" }));
    expect(onInviteMember).not.toHaveBeenCalled();
  });

  it("renders existing members with their status", async () => {
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByText("Alpha"));
    await user.click(screen.getByRole("button", { name: "members" }));
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("moderator")).toBeInTheDocument();
  });
});

describe("TeamPanel roles, activity and close", () => {
  it("renders all roles on the roles tab", async () => {
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "roles" }));
    for (const role of ["admin", "moderator", "member", "guest"]) {
      expect(screen.getByText(role, { selector: "div" })).toBeInTheDocument();
    }
  });

  it("renders the activity tab", async () => {
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "activity" }));
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("closes via the × button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the Close button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TeamPanel teams={teams} onCreateTeam={vi.fn()} onInviteMember={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
