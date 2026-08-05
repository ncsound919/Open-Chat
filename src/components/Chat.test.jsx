import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Chat } from "./Chat.jsx";

vi.mock("../utils/OnDeviceAI.js", () => ({
  isAvailable: vi.fn(() => Promise.resolve(true)),
  generateStream: vi.fn(),
  buildInsightPrompt: vi.fn(() => "prompt"),
}));

function hermesBot(overrides = {}) {
  return {
    id: "b1",
    name: "Hermes",
    avatar: "☿",
    color: "#818cf8",
    tagline: "Nous Research",
    protocol: "hermes",
    host: "127.0.0.1",
    port: 8642,
    token: "",
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    bot: hermesBot(),
    messages: [],
    status: "connected",
    input: "",
    streaming: false,
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onInterrupt: vi.fn(),
    onBack: vi.fn(),
    onOpenSettings: vi.fn(),
    onDeleteMessage: vi.fn(),
    onClearChat: vi.fn(),
    ...overrides,
  };
}

describe("Chat header", () => {
  it("renders the header with back button, avatar, name and status", () => {
    const onBack = vi.fn();
    render(<Chat {...baseProps({ onBack })} />);
    expect(screen.getAllByText("Hermes").length).toBeGreaterThan(0);
    expect(screen.getByText("online")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("falls back to the ellipsis status label for unknown statuses", () => {
    render(<Chat {...baseProps({ status: "weird" })} />);
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("renders the error status label", () => {
    render(<Chat {...baseProps({ status: "error" })} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("falls back to the default color for invalid bot colors", () => {
    render(<Chat {...baseProps({ bot: hermesBot({ color: "url(javascript:1)" }) })} />);
    const back = screen.getByLabelText("Back");
    expect(back.style.color).toBe("rgb(129, 140, 248)");
  });
});

describe("Chat empty states", () => {
  it("renders the hermes empty state with a plain host", () => {
    render(<Chat {...baseProps({ bot: hermesBot({ port: 0 }) })} />);
    expect(screen.getByText(/Connects to Hermes API at/)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:8642/)).toBeInTheDocument();
  });

  it("renders the hermes empty state with a full tunnel URL", () => {
    render(
      <Chat {...baseProps({ bot: hermesBot({ host: "https://api.example.com/" }) })} />
    );
    expect(screen.getByText(/Connects to Hermes API at/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/api\.example\.com/)).toBeInTheDocument();
  });

  it("renders the openclaw empty state", () => {
    render(<Chat {...baseProps({ bot: hermesBot({ protocol: "openclaw" }) })} />);
    expect(screen.getByText(/Connects to OpenClaw gateway at/)).toBeInTheDocument();
    expect(screen.getByText(/ws:\/\/127\.0\.0\.1:8642/)).toBeInTheDocument();
  });

  it("renders the uplift-bridge empty state", () => {
    render(<Chat {...baseProps({ bot: hermesBot({ protocol: "uplift-bridge" }) })} />);
    expect(screen.getByText(/Connects to Uplift Bridge at/)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:8642/)).toBeInTheDocument();
  });

  it("renders the subteam empty state", () => {
    render(<Chat {...baseProps({ bot: hermesBot({ protocol: "subteam" }) })} />);
    expect(screen.getByText(/Connects to SubTeam agent at/)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:8642/)).toBeInTheDocument();
  });

  it("renders the draymond empty state with a full URL host", () => {
    render(
      <Chat
        {...baseProps({
          bot: hermesBot({ protocol: "draymond", host: "https://tunnel.example.com/" }),
        })}
      />
    );
    expect(screen.getByText(/Connects to Draymond Orchestrator at/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/tunnel\.example\.com\/api\/v1/)).toBeInTheDocument();
  });

  it("renders the draymond empty state with a non-localhost host", () => {
    render(
      <Chat
        {...baseProps({
          bot: hermesBot({ protocol: "draymond", host: "tunnel.example.com" }),
        })}
      />
    );
    expect(screen.getByText(/https:\/\/tunnel\.example\.com\/api\/v1/)).toBeInTheDocument();
  });

  it("renders the draymond empty state with a localhost host and custom port", () => {
    render(
      <Chat
        {...baseProps({
          bot: hermesBot({ protocol: "draymond", host: "localhost", port: 9999 }),
        })}
      />
    );
    expect(screen.getByText(/http:\/\/localhost:9999\/api\/v1/)).toBeInTheDocument();
  });
});

describe("Chat input and send", () => {
  it("calls onInputChange while typing and onSend on Enter", () => {
    const onInputChange = vi.fn();
    const onSend = vi.fn();
    render(<Chat {...baseProps({ onInputChange, onSend })} />);
    const input = screen.getByPlaceholderText("Message");
    fireEvent.change(input, { target: { value: "hi" } });
    expect(onInputChange).toHaveBeenCalledWith("hi");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalled();
  });

  it("does not send on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<Chat {...baseProps({ onSend })} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Message"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button when the input is empty", () => {
    const onSend = vi.fn();
    render(<Chat {...baseProps({ onSend })} />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("enables the send button when the input is non-empty", () => {
    const onSend = vi.fn();
    render(<Chat {...baseProps({ input: "text", onSend })} />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalled();
  });

  it("shows the streaming state with a stop button", () => {
    const onInterrupt = vi.fn();
    render(<Chat {...baseProps({ streaming: true, onInterrupt })} />);
    expect(screen.getByPlaceholderText("Agent is responding…")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop responding" }));
    expect(onInterrupt).toHaveBeenCalled();
  });
});

describe("Chat kebab menu", () => {
  it("opens settings from the menu", () => {
    const onOpenSettings = vi.fn();
    render(<Chat {...baseProps({ onOpenSettings })} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("clears the chat after confirming", () => {
    const onClearChat = vi.fn();
    window.confirm = vi.fn(() => true);
    render(<Chat {...baseProps({ onClearChat })} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    fireEvent.click(screen.getByRole("button", { name: "Clear Chat" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClearChat).toHaveBeenCalled();
  });

  it("does not clear the chat when confirmation is cancelled", () => {
    const onClearChat = vi.fn();
    window.confirm = vi.fn(() => false);
    render(<Chat {...baseProps({ onClearChat })} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    fireEvent.click(screen.getByRole("button", { name: "Clear Chat" }));
    expect(onClearChat).not.toHaveBeenCalled();
  });

  it("closes the menu on Escape", () => {
    render(<Chat {...baseProps()} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    expect(screen.getByRole("button", { name: "Clear Chat" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Clear Chat" })).not.toBeInTheDocument();
  });

  it("closes the menu when the backdrop is clicked", () => {
    const { container } = render(<Chat {...baseProps()} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    const overlay = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.position === "fixed" && d.style.zIndex === "10"
    );
    fireEvent.click(overlay);
    expect(screen.queryByRole("button", { name: "Clear Chat" })).not.toBeInTheDocument();
  });

  it("closes the menu when the messages area is clicked", () => {
    render(<Chat {...baseProps()} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    const emptyState = screen.getByText(/Connects to Hermes API at/);
    fireEvent.click(emptyState);
    expect(screen.queryByRole("button", { name: "Clear Chat" })).not.toBeInTheDocument();
  });

  it("highlights menu items on hover", () => {
    render(<Chat {...baseProps()} />);
    fireEvent.click(screen.getByLabelText("Chat menu"));
    const settings = screen.getByRole("button", { name: /Settings/ });
    fireEvent.mouseEnter(settings);
    expect(settings.style.background).not.toBe("none");
    fireEvent.mouseLeave(settings);
    expect(settings.style.background).toBe("none");
    const clear = screen.getByRole("button", { name: "Clear Chat" });
    fireEvent.mouseEnter(clear);
    expect(clear.style.background).not.toBe("none");
    fireEvent.mouseLeave(clear);
    expect(clear.style.background).toBe("none");
  });
});

describe("Chat Draymond features", () => {
  it("shows the notification badge and clears unread", () => {
    const onClearUnread = vi.fn();
    render(
      <Chat
        {...baseProps({
          bot: hermesBot({ protocol: "draymond" }),
          unreadNotifications: 3,
          onClearUnread,
        })}
      />
    );
    fireEvent.click(screen.getByLabelText("3 unread notifications"));
    expect(onClearUnread).toHaveBeenCalled();
  });

  it("caps the notification badge at 99", () => {
    render(
      <Chat
        {...baseProps({
          bot: hermesBot({ protocol: "draymond" }),
          unreadNotifications: 150,
          onClearUnread: vi.fn(),
        })}
      />
    );
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("does not show the badge when there are no unread notifications", () => {
    render(
      <Chat {...baseProps({ bot: hermesBot({ protocol: "draymond" }), unreadNotifications: 0 })}
      />
    );
    expect(screen.queryByLabelText(/unread notifications/)).not.toBeInTheDocument();
  });

  it("toggles the chain activity strip and renders all chain types", () => {
    const chains = [
      { chain_instance_id: "c1", type: "chain_started", chain_name: "Build" },
      { chain_instance_id: "c2", type: "chain_completed", chain_name: "Deploy" },
      { chain_instance_id: "c3", type: "chain_failed", chain_slug: "failed-slug" },
      { chain_instance_id: "c4", type: "chain_step", chain_name: "" },
    ];
    render(
      <Chat
        {...baseProps({
          bot: hermesBot({ protocol: "draymond" }),
          draymondChains: chains,
        })}
      />
    );
    fireEvent.click(screen.getByLabelText("Toggle chain activity"));
    expect(screen.getByText("Chain Activity")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Deploy")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("failed-slug")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Step")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Toggle chain activity"));
    expect(screen.queryByText("Chain Activity")).not.toBeInTheDocument();
  });

  it("does not show chain controls when there are no chains", () => {
    render(
      <Chat {...baseProps({ bot: hermesBot({ protocol: "draymond" }) })} />
    );
    expect(screen.queryByLabelText("Toggle chain activity")).not.toBeInTheDocument();
  });
});

describe("Chat quick actions", () => {
  it("renders the mic button only when supported and wires pointer handlers", () => {
    const onMicPointerDown = vi.fn();
    const onMicPointerUp = vi.fn();
    const onMicCancel = vi.fn();
    render(
      <Chat
        {...baseProps({
          onMicPointerDown,
          onMicPointerUp,
          onMicCancel,
          voiceSupported: true,
          voiceMicActive: true,
        })}
      />
    );
    const mic = screen.getByLabelText("Release to send");
    fireEvent.pointerDown(mic);
    expect(onMicPointerDown).toHaveBeenCalled();
    fireEvent.pointerUp(mic);
    expect(onMicPointerUp).toHaveBeenCalled();
    fireEvent.pointerLeave(mic);
    expect(onMicCancel).toHaveBeenCalled();
  });

  it("shows the idle mic label when not active", () => {
    render(
      <Chat
        {...baseProps({ onMicPointerDown: vi.fn(), voiceSupported: true, voiceMicActive: false })}
      />
    );
    expect(screen.getByLabelText("Hold to talk")).toBeInTheDocument();
  });

  it("hides the mic button when voice is unsupported", () => {
    render(<Chat {...baseProps({ onMicPointerDown: vi.fn() })} />);
    expect(screen.queryByLabelText(/talk/)).not.toBeInTheDocument();
  });

  it("renders and wires the speak button", () => {
    const onToggleSpeak = vi.fn();
    render(<Chat {...baseProps({ onToggleSpeak, voiceEnabled: true })} />);
    const speak = screen.getByLabelText("Auto-speak on");
    fireEvent.click(speak);
    expect(onToggleSpeak).toHaveBeenCalled();
  });

  it("shows the speak button in the off state", () => {
    render(<Chat {...baseProps({ onToggleSpeak: vi.fn(), voiceEnabled: false })} />);
    expect(screen.getByLabelText("Auto-speak off")).toBeInTheDocument();
  });

  it("renders and wires the copy last reply button", () => {
    const onCopyLastReply = vi.fn();
    render(<Chat {...baseProps({ onCopyLastReply })} />);
    fireEvent.click(screen.getByLabelText("Copy last reply"));
    expect(onCopyLastReply).toHaveBeenCalled();
  });

  it("renders and wires the pin button", () => {
    const onTogglePin = vi.fn();
    render(<Chat {...baseProps({ onTogglePin, pinned: true })} />);
    fireEvent.click(screen.getByLabelText("Unpin bot"));
    expect(onTogglePin).toHaveBeenCalled();
  });

  it("shows the pin button in the unpinned state", () => {
    render(<Chat {...baseProps({ onTogglePin: vi.fn(), pinned: false })} />);
    expect(screen.getByLabelText("Pin bot")).toBeInTheDocument();
  });

  it("renders and wires the quick clear chat button", () => {
    const onClearChat = vi.fn();
    render(<Chat {...baseProps({ onClearChat })} />);
    fireEvent.click(screen.getByLabelText("Clear chat"));
    expect(onClearChat).toHaveBeenCalled();
  });
});

describe("Chat message list", () => {
  it("renders messages and computes last user message context", () => {
    const messages = [
      { id: "m1", role: "bot", text: "first bot" },
      { id: "m2", role: "user", text: "hello" },
      { id: "m3", role: "bot", text: "reply bot" },
    ];
    render(<Chat {...baseProps({ messages })} />);
    expect(screen.getByText("first bot")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("reply bot")).toBeInTheDocument();
  });

  it("calls onDeleteMessage from the context menu", () => {
    const onDeleteMessage = vi.fn();
    render(
      <Chat
        {...baseProps({
          messages: [{ id: "m1", role: "user", text: "delete me" }],
          onDeleteMessage,
        })}
      />
    );
    fireEvent.contextMenu(screen.getByText("delete me"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteMessage).toHaveBeenCalledWith("m1");
  });

  it("does not render the empty state when messages exist", () => {
    render(
      <Chat {...baseProps({ messages: [{ id: "m1", role: "user", text: "x" }] })}
      />
    );
    expect(screen.queryByText(/Connects to Hermes API at/)).not.toBeInTheDocument();
  });
});
