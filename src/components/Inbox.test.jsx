import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "./Inbox.jsx";

const bots = [
  {
    id: "b1",
    name: "Alpha",
    avatar: "🤖",
    color: "#22d3ee",
    protocol: "openclaw",
    pinned: true,
    tagline: "alpha tag",
  },
  {
    id: "b2",
    name: "Beta",
    avatar: "🐙",
    color: "#34d399",
    protocol: "hermes",
    pinned: false,
    tagline: "beta tag",
  },
  {
    id: "b3",
    name: "Gamma",
    avatar: "🚀",
    color: "#f59e0b",
    protocol: "draymond",
    pinned: false,
    tagline: "gamma tag",
  },
];

const history = {
  b1: [
    { id: "b1u", role: "user", text: "hey alpha", time: "09:00", _seen: true },
    { id: "b1m", role: "bot", text: "unread alpha", time: "09:01", _seen: false },
    { id: "b1m2", role: "bot", text: "another", time: "09:02", _seen: true },
  ],
  b2: [
    { id: "b2u", role: "user", text: "hi beta", time: "10:00", _seen: true },
    { id: "b2m", role: "bot", text: "reply beta", time: "10:01", _seen: true },
  ],
};

function baseProps(overrides = {}) {
  return {
    bots,
    history,
    statuses: {},
    search: "",
    onSearch: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenSettings: vi.fn(),
    onAddBot: vi.fn(),
    mode: "dev",
    onToggleMode: vi.fn(),
    ...overrides,
  };
}

describe("Inbox rendering", () => {
  it("renders bot names, avatars and taglines when there is no history", () => {
    render(<Inbox {...baseProps({ history: {} })} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("alpha tag")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("beta tag")).toBeInTheDocument();
  });

  it("shows the last bot message preview and unread badge", () => {
    render(<Inbox {...baseProps()} />);
    expect(screen.getByText("another")).toBeInTheDocument();
    expect(screen.getByText("09:02")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("prefixes user messages with You:", () => {
    render(
      <Inbox
        {...baseProps({
          history: { b2: [{ id: "b2u", role: "user", text: "hi beta", time: "10:00", _seen: true }] },
        })}
      />
    );
    expect(screen.getByText(/You: hi beta/)).toBeInTheDocument();
  });

  it("caps the unread badge at 9+", () => {
    const bigHistory = {
      b2: Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        role: "bot",
        text: `msg ${i}`,
        time: "10:00",
        _seen: false,
      })),
    };
    render(<Inbox {...baseProps({ history: bigHistory })} />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("sorts pinned bots to the top and shows the pin star", () => {
    render(<Inbox {...baseProps({ pinnedIds: ["b3"] })} />);
    const alpha = screen.getByText("Alpha");
    const gamma = screen.getByText("Gamma");
    expect(
      gamma.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("★")).toBeInTheDocument();
  });

  it("shows the protocol badge WS for openclaw and HTTP for others in dev mode", () => {
    render(<Inbox {...baseProps()} />);
    expect(screen.getByText("WS")).toBeInTheDocument();
    expect(screen.getAllByText("HTTP").length).toBeGreaterThanOrEqual(2);
  });

  it("hides the protocol badge in basic mode", () => {
    render(<Inbox {...baseProps({ mode: "basic" })} />);
    expect(screen.queryByText("WS")).not.toBeInTheDocument();
    expect(screen.queryByText("HTTP")).not.toBeInTheDocument();
  });
});

describe("Inbox interactions", () => {
  it("calls onOpenChat when a bot row is clicked", () => {
    const onOpenChat = vi.fn();
    render(<Inbox {...baseProps({ onOpenChat })} />);
    fireEvent.click(screen.getByText("Beta"));
    expect(onOpenChat).toHaveBeenCalledWith("b2");
  });

  it("applies hover background on mouse enter and leave", () => {
    render(<Inbox {...baseProps()} />);
    const row = screen.getByText("Beta").closest('div[style*="cursor"]');
    fireEvent.mouseEnter(row);
    expect(row.style.background).toBe("rgb(23, 23, 31)");
    fireEvent.mouseLeave(row);
    expect(row.style.background).toBe("transparent");
  });

  it("opens settings from the gear button without opening the chat", () => {
    const onOpenSettings = vi.fn();
    const onOpenChat = vi.fn();
    render(<Inbox {...baseProps({ onOpenSettings, onOpenChat })} />);
    const beta = screen.getByText("Beta");
    const row = beta.closest('div[style*="cursor"]');
    fireEvent.click(row.querySelector("button"));
    expect(onOpenSettings).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b2", name: "Beta" })
    );
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("calls onAddBot and onToggleMode from the header", () => {
    const onAddBot = vi.fn();
    const onToggleMode = vi.fn();
    render(<Inbox {...baseProps({ onAddBot, onToggleMode })} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Basic mode" }));
    expect(onToggleMode).toHaveBeenCalled();
    const header = screen
      .getByRole("heading", { name: "Messages" })
      .parentElement.parentElement;
    fireEvent.click(header.lastElementChild);
    expect(onAddBot).toHaveBeenCalled();
  });

  it("labels the mode button in basic mode", () => {
    render(<Inbox {...baseProps({ mode: "basic" })} />);
    expect(screen.getByRole("button", { name: "Switch to Dev mode" })).toBeInTheDocument();
  });

  it("filters bots by search and shows the empty search state", () => {
    render(<Inbox {...baseProps({ search: "alpha" })} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("calls onSearch while typing in the search field", () => {
    const onSearch = vi.fn();
    render(<Inbox {...baseProps({ onSearch })} />);
    fireEvent.change(screen.getByPlaceholderText("Search agents…"), {
      target: { value: "claw" },
    });
    expect(onSearch).toHaveBeenCalledWith("claw");
  });

  it("shows the no-agents empty state without a search", () => {
    render(<Inbox {...baseProps({ bots: [] })} />);
    expect(screen.getByText("No agents — tap + to add one")).toBeInTheDocument();
  });

  it("shows the no-matches empty state with a search", () => {
    render(<Inbox {...baseProps({ bots: [], search: "zzz" })} />);
    expect(screen.getByText("No agents match your search")).toBeInTheDocument();
  });
});

describe("Inbox search modes", () => {
  it("shows search mode buttons when the query is non-empty", () => {
    render(<Inbox {...baseProps({ search: "x" })} />);
    expect(screen.getByRole("button", { name: "Bots" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
  });

  it("hides search mode buttons when the query is empty", () => {
    render(<Inbox {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "Bots" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Messages" })).not.toBeInTheDocument();
  });

  it("calls onSearchMode for bots and messages", async () => {
    const onSearchMode = vi.fn();
    const user = userEvent.setup();
    render(<Inbox {...baseProps({ search: "x", onSearchMode })} />);
    await user.click(screen.getByRole("button", { name: "Bots" }));
    expect(onSearchMode).toHaveBeenCalledWith("bots");
    await user.click(screen.getByRole("button", { name: "Messages" }));
    expect(onSearchMode).toHaveBeenCalledWith("messages");
  });

  it("highlights the Messages search mode when active", () => {
    render(<Inbox {...baseProps({ search: "x", searchMode: "messages" })} />);
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bots" })).toBeInTheDocument();
  });

  it("does not crash when onSearchMode is not provided", () => {
    render(<Inbox {...baseProps({ search: "x", onSearchMode: null })} />);
    fireEvent.click(screen.getByRole("button", { name: "Bots" }));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(screen.getByRole("button", { name: "Bots" })).toBeInTheDocument();
  });
});
