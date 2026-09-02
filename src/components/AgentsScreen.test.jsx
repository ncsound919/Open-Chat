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
    // Roster sorts active agents first: Uplift (active) is index 0, Megacode (idle) is index 1.
    const chatBtns = screen.getAllByText("Chat");
    fireEvent.click(chatBtns[0]);
    expect(onOpenChat).toHaveBeenCalledWith("agent-uplift-agent");
  });

  it("sorts active agents to the top", () => {
    const { container } = render(
      <AgentsScreen agents={AGENTS} bots={[]} statuses={{}} onOpenChat={() => {}} onOpenSettings={() => {}} />
    );
    const names = [...container.querySelectorAll("span")].map((s) => s.textContent);
    const upliftIdx = names.findIndex((t) => t === "Uplift Agent");
    const megaIdx = names.findIndex((t) => t === "Megacode");
    expect(upliftIdx).toBeGreaterThan(-1);
    expect(megaIdx).toBeGreaterThan(-1);
    expect(upliftIdx).toBeLessThan(megaIdx); // active Uplift before idle Megacode
  });

  it("prioritizes agents with active chats and displays the active badge", () => {
    const bots = [
      { id: "agent-megacode", name: "Megacode", agentRef: "megacode" },
      { id: "agent-uplift-agent", name: "Uplift Agent", agentRef: "uplift-agent" },
    ];
    const history = {
      "agent-megacode": [{ id: "m1", text: "Working on tasks", time: Date.now() }],
    };
    render(
      <AgentsScreen
        agents={AGENTS}
        bots={bots}
        history={history}
        onOpenChat={() => {}}
        onOpenSettings={() => {}}
      />
    );
    expect(screen.getByText("● Active Chat")).toBeInTheDocument();
    expect(screen.getByText("Working on tasks")).toBeInTheDocument();
  });
});
