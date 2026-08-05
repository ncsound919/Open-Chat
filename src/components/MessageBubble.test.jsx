import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageBubble } from "./MessageBubble.jsx";

vi.mock("../utils/OnDeviceAI.js", () => ({
  isAvailable: vi.fn(() => Promise.resolve(true)),
  generateStream: vi.fn(),
  buildInsightPrompt: vi.fn(() => "prompt"),
}));

function userMsg(overrides = {}) {
  return {
    role: "user",
    text: "hello there",
    read: false,
    streaming: false,
    error: false,
    ...overrides,
  };
}

function botMsg(overrides = {}) {
  return {
    role: "assistant",
    text: "**bold** reply",
    streaming: false,
    error: false,
    ...overrides,
  };
}

const bot = { color: "#22d3ee", protocol: "hermes" };
const botDraymond = { color: "#34d399", protocol: "draymond" };

afterEach(() => {
  if (global.navigator && global.navigator.clipboard) {
    delete global.navigator.clipboard;
  }
});

describe("MessageBubble rendering", () => {
  it("renders user messages as plain text", () => {
    render(
      <MessageBubble msg={userMsg()} bot={bot} onDelete={vi.fn()} lastUserMessage="" />
    );
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("renders the double-check icon when a user message is read", () => {
    render(
      <MessageBubble msg={userMsg({ read: true })} bot={bot} onDelete={vi.fn()} />
    );
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("renders bot messages through the markdown renderer", () => {
    render(
      <MessageBubble msg={botMsg()} bot={bot} onDelete={vi.fn()} />
    );
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByText("reply")).toBeInTheDocument();
  });

  it("sanitizes dangerous markup", () => {
    render(
      <MessageBubble
        msg={userMsg({ text: '<script>alert("x")</script>safe' })}
        bot={bot}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("safe")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("renders partial text while streaming", () => {
    render(
      <MessageBubble
        msg={botMsg({ streaming: true, text: "partial" })}
        bot={bot}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("partial")).toBeInTheDocument();
  });

  it("renders the OnDeviceInsights panel for a Draymond bot message", () => {
    render(
      <MessageBubble
        msg={botMsg({ text: "analysis done" })}
        bot={botDraymond}
        onDelete={vi.fn()}
        lastUserMessage="analyze"
      />
    );
    expect(screen.getByText(/On-device insights/)).toBeInTheDocument();
  });
});

describe("MessageBubble context menu", () => {
  it("opens the context menu on right-click", async () => {
    render(<MessageBubble msg={userMsg()} bot={bot} onDelete={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("hello there").closest("div"));
    expect(screen.getByText("Copy text")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("copies the message text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<MessageBubble msg={botMsg()} bot={bot} onDelete={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("bold").closest("div"));
    fireEvent.click(screen.getByText("Copy text"));
    expect(writeText).toHaveBeenCalledWith("**bold** reply");
    // copy() closes the menu, so the button is unmounted again
    expect(screen.queryByText("Copy text")).not.toBeInTheDocument();
  });

  it("deletes the message when Delete is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<MessageBubble msg={userMsg()} bot={bot} onDelete={onDelete} />);
    fireEvent.contextMenu(screen.getByText("hello there").closest("div"));
    await user.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    const user = userEvent.setup();
    render(<MessageBubble msg={userMsg()} bot={bot} onDelete={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("hello there").closest("div"));
    expect(screen.getByText("Copy text")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Copy text")).not.toBeInTheDocument();
  });

  it("closes the menu when the backdrop overlay is clicked", () => {
    const { container } = render(
      <MessageBubble msg={userMsg()} bot={bot} onDelete={vi.fn()} />
    );
    fireEvent.contextMenu(screen.getByText("hello there").closest("div"));
    const overlay = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.position === "fixed" && d.style.zIndex === "40"
    );
    fireEvent.click(overlay);
    expect(screen.queryByText("Copy text")).not.toBeInTheDocument();
  });
});

describe("MessageBubble ntfy actions", () => {
  it("renders action buttons and calls onNtfyAction", async () => {
    const onNtfyAction = vi.fn(async () => ({ ok: true, output: "approved" }));
    const user = userEvent.setup();
    const msg = botMsg({
      text: "Approve this change",
      actions: [{ label: "Approve", url: "https://x" }, { label: "Reject" }],
    });
    render(
      <MessageBubble msg={msg} bot={bot} onDelete={vi.fn()} onNtfyAction={onNtfyAction} />
    );
    const approve = screen.getByText("Approve");
    await user.click(approve);
    expect(onNtfyAction).toHaveBeenCalledWith({ label: "Approve", url: "https://x" });
    expect(await screen.findByText("✓ Done")).toBeInTheDocument();
  });

  it("shows the failed state when onNtfyAction reports an error", async () => {
    const onNtfyAction = vi.fn(async () => ({ ok: false, error: "nope" }));
    const user = userEvent.setup();
    const msg = botMsg({
      text: "x",
      actions: [{ label: "Retry", url: "https://x" }],
    });
    render(
      <MessageBubble msg={msg} bot={bot} onDelete={vi.fn()} onNtfyAction={onNtfyAction} />
    );
    await user.click(screen.getByText("Retry"));
    expect(await screen.findByText("✕ Failed")).toBeInTheDocument();
  });

  it("does not render action buttons when onNtfyAction is missing", () => {
    render(
      <MessageBubble
        msg={botMsg({ text: "x", actions: [{ label: "Approve" }] })}
        bot={bot}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });
});
