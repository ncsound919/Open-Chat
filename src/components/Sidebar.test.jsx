import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar.jsx";

describe("Sidebar", () => {
  it("shows labeled navigation items", () => {
    render(<Sidebar open onClose={() => {}} onNavigate={() => {}} />);
    for (const label of ["Home", "Chats", "Agents", "Work", "Models", "Settings"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("navigates when an item is clicked", () => {
    const onNavigate = vi.fn();
    render(<Sidebar open onClose={() => {}} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("Agents"));
    expect(onNavigate).toHaveBeenCalledWith("agents");
  });

  it("navigates to work", () => {
    const onNavigate = vi.fn();
    render(<Sidebar open onClose={() => {}} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("Work"));
    expect(onNavigate).toHaveBeenCalledWith("work");
  });

  it("opens the Private Local chat from the shortcut", () => {
    const onNavigate = vi.fn();
    render(<Sidebar open onClose={() => {}} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("Private Local"));
    expect(onNavigate).toHaveBeenCalledWith("local");
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(<Sidebar open onClose={onClose} onNavigate={() => {}} />);
    const backdrop = document.querySelector('[aria-hidden="true"]');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows unread and agent badges", () => {
    render(<Sidebar open onClose={() => {}} onNavigate={() => {}} unread={5} agentCount={12} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
