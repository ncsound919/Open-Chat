import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentsScreen } from "./AgentsScreen.jsx";

const AGENTS = {
  "uplift-agent": {
    id: "uplift-agent",
    name: "Uplift Agent",
    status: "active",
    capabilities: [
      { id: "codegen", label: "Code Generation" },
      { id: "tool-use", label: "Tool Orchestration" },
    ],
  },
  megacode: { id: "megacode", name: "Megacode", status: "idle", capabilities: [] },
};

describe("AgentsScreen", () => {
  it("renders the roster with names, ids, and capability chips", () => {
    render(
      <AgentsScreen agents={AGENTS} bots={[]} statuses={{}} onOpenChat={() => {}} onOpenSettings={() => {}} />
    );
    expect(screen.getByText("Uplift Agent")).toBeInTheDocument();
    expect(screen.getByText("megacode")).toBeInTheDocument();
    expect(screen.getByText("Code Generation")).toBeInTheDocument();
  });

  it("shows an empty state when no agents exist", () => {
    render(<AgentsScreen agents={{}} bots={[]} statuses={{}} onOpenChat={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByText(/No agents discovered/i)).toBeInTheDocument();
  });

  it("opens a chat for an agent bot when it exists", () => {
    const bots = [{ id: "agent-uplift-agent", name: "Uplift Agent", agentRef: "uplift-agent" }];
    const onOpenChat = vi.fn();
    render(<AgentsScreen agents={AGENTS} bots={bots} statuses={{}} onOpenChat={onOpenChat} onOpenSettings={() => {}} />);
    // Roster is sorted alphabetically: Megacode first, then Uplift Agent.
    const chatBtns = screen.getAllByText("Chat");
    fireEvent.click(chatBtns[1]);
    expect(onOpenChat).toHaveBeenCalledWith("agent-uplift-agent");
  });
});
