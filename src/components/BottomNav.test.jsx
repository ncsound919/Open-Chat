import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomNav } from "./BottomNav.jsx";

describe("BottomNav", () => {
  it("renders all five tabs", () => {
    render(<BottomNav tab="chats" onChange={() => {}} />);
    expect(screen.getByText("Chats")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("calls onChange with the selected tab", () => {
    const onChange = vi.fn();
    render(<BottomNav tab="chats" onChange={onChange} />);
    fireEvent.click(screen.getByText("Models"));
    expect(onChange).toHaveBeenCalledWith("models");
  });

  it("navigates to work", () => {
    const onChange = vi.fn();
    render(<BottomNav tab="chats" onChange={onChange} />);
    fireEvent.click(screen.getByText("Work"));
    expect(onChange).toHaveBeenCalledWith("work");
  });

  it("marks the active tab", () => {
    render(<BottomNav tab="agents" onChange={() => {}} />);
    const agents = screen.getByText("Agents").closest("button");
    expect(agents.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the unread badge when unread > 0", () => {
    render(<BottomNav tab="chats" onChange={() => {}} unread={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the unread badge at zero", () => {
    render(<BottomNav tab="chats" onChange={() => {}} unread={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
