import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen.jsx";

const BOTS = [
  { id: "draymond", name: "Draymond", avatar: "🎛️", color: "#22d3ee", protocol: "draymond" },
];
const HISTORY = {
  draymond: [
    { id: "u1", role: "user", text: "hello", time: "10:00", read: true },
    { id: "b1", role: "bot", text: "hi there", time: "10:01", read: false },
  ],
};

describe("HomeScreen", () => {
  it("renders a greeting and app title", () => {
    render(
      <HomeScreen
        onOpenMenu={() => {}}
        onNavigate={() => {}}
        bots={BOTS}
        history={HISTORY}
        agents={{}}
      />
    );
    expect(screen.getByText("Open Chat")).toBeInTheDocument();
    expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeInTheDocument();
  });

  it("opens the sidebar via the menu button", () => {
    const onOpenMenu = vi.fn();
    render(
      <HomeScreen
        onOpenMenu={onOpenMenu}
        onNavigate={() => {}}
        bots={BOTS}
        history={HISTORY}
        agents={{}}
      />
    );
    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(onOpenMenu).toHaveBeenCalled();
  });

  it("navigates to a destination card", () => {
    const onNavigate = vi.fn();
    render(
      <HomeScreen
        onOpenMenu={() => {}}
        onNavigate={onNavigate}
        bots={BOTS}
        history={HISTORY}
        agents={{}}
      />
    );
    fireEvent.click(screen.getByText("Agents").closest("button"));
    expect(onNavigate).toHaveBeenCalledWith("agents");
  });

  it("shows the unread count and recent conversations", () => {
    render(
      <HomeScreen
        onOpenMenu={() => {}}
        onNavigate={() => {}}
        bots={BOTS}
        history={HISTORY}
        agents={{}}
        unread={1}
      />
    );
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByText("Draymond")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("shows an empty recent state without history", () => {
    render(
      <HomeScreen onOpenMenu={() => {}} onNavigate={() => {}} bots={BOTS} history={{}} agents={{}}
      />
    );
    expect(screen.queryByText("RECENT")).not.toBeInTheDocument();
  });
});
