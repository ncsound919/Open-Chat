import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Module mocks (hoisted above the App import) ─────────────────────────────
// Network-facing protocol clients + the voice hook are mocked so App renders
// deterministically without sockets/fetch/audio in jsdom.
vi.mock("./protocols/HermesClient.js", () => ({
  hermesStream: vi.fn(async (_host, _port, _token, _messages, onChunk, _signal) => {
    onChunk("assistant reply");
    return "assistant reply";
  }),
  hermesHealthCheck: vi.fn(async () => true),
}));

vi.mock("./protocols/OpenClawClient.js", () => ({
  OpenClawClient: vi.fn(function (host, port, token) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.ws = { readyState: 1 }; // WebSocket.OPEN === 1
    this.conversationHistory = [];
    this.send = vi.fn((text, onChunk) => {
      onChunk?.("claw reply");
      return Promise.resolve("claw reply");
    });
    this.connect = vi.fn(async () => {
      this.ws = { readyState: 1 };
      this.onStatusChange?.("connected");
      return true;
    });
    this.disconnect = vi.fn(() => {
      this.ws = null;
    });
  }),
}));

vi.mock("./protocols/UpliftBridgeClient.js", () => ({
  UpliftBridgeClient: vi.fn(function (host, port, token) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.sessionId = "sess-1";
    this.send = vi.fn((text, onChunk) => {
      onChunk?.("bridge reply");
      return Promise.resolve("bridge reply");
    });
    this.connect = vi.fn(async () => {
      this.sessionId = "sess-1";
      this.onStatusChange?.("connected");
      return true;
    });
    this.disconnect = vi.fn();
  }),
}));

vi.mock("./protocols/SubTeamClient.js", () => ({
  subTeamStream: vi.fn(async (_host, _port, _token, _messages, onChunk, _signal) => {
    onChunk("subteam reply");
    return "subteam reply";
  }),
  subTeamHealthCheck: vi.fn(async () => true),
}));

vi.mock("./protocols/DraymondOrchestratorClient.js", () => ({
  DraymondOrchestratorClient: vi.fn(function (host, port, token) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.status = "disconnected";
    this.connect = vi.fn(async () => {
      this.status = "connected";
      this.onStatusChange?.("connected");
      return true;
    });
    this.disconnect = vi.fn(() => {
      this.status = "disconnected";
    });
    this.orchestrate = vi.fn(async (opts) => {
      opts?.onPhaseUpdate?.("analyzing");
      opts?.onChunk?.("dray reply");
      opts?.onToolExecution?.();
      return { text: "dray final" };
    });
    this.listChains = vi.fn(async () => []);
    this.listSchedules = vi.fn(async () => []);
    this.executeChain = vi.fn(async () => {});
    this.toggleSchedule = vi.fn(async () => {});
  }),
}));

vi.mock("./protocols/NtfyClient.js", () => ({
  NtfyClient: vi.fn(function (host, port, token, topic) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.topic = topic;
    this.status = "disconnected";
    this.connect = vi.fn(async () => {
      this.status = "connected";
      this.onStatusChange?.("connected");
      return true;
    });
    this.disconnect = vi.fn(() => {
      this.status = "disconnected";
    });
    this.publish = vi.fn(async () => true);
    this.executeAction = vi.fn(async () => ({ ok: true, output: "done" }));
  }),
}));

vi.mock("./hooks/useVoice.js", () => ({
  useVoice: vi.fn(() => ({
    micActive: false,
    speakEnabled: false,
    micError: null,
    setSpeakEnabled: vi.fn(),
    startListening: vi.fn(async () => true),
    stopAndTranscribe: vi.fn(async () => ""),
    cancelListening: vi.fn(async () => {}),
    speak: vi.fn(async () => {}),
  })),
}));

import App from "./App.jsx";
import { OpenClawClient } from "./protocols/OpenClawClient.js";
import { UpliftBridgeClient } from "./protocols/UpliftBridgeClient.js";
import { DraymondOrchestratorClient } from "./protocols/DraymondOrchestratorClient.js";
import { NtfyClient } from "./protocols/NtfyClient.js";
import { hermesStream } from "./protocols/HermesClient.js";

const CONF_KEY = "openchat_conf_v1";
const HIST_KEY = "openchat_hist_v1";
const MODE_KEY = "openchat_mode_v1";

const SEED_BOTS = [
  { id: "hermes", name: "Hermes", avatar: "☿", color: "#818cf8", tagline: "Nous Research", protocol: "hermes", host: "127.0.0.1", port: 8642, token: "" },
  { id: "openclaw", name: "Claw", avatar: "🦞", color: "#34d399", tagline: "OpenClaw", protocol: "openclaw", host: "127.0.0.1", port: 18789, token: "" },
  { id: "uplift", name: "Uplift", avatar: "🚀", color: "#f59e0b", tagline: "Bridge", protocol: "uplift-bridge", host: "127.0.0.1", port: 8642, token: "" },
  { id: "subteam", name: "SubTeam", avatar: "🧠", color: "#a78bfa", tagline: "CPU Design", protocol: "subteam", host: "127.0.0.1", port: 8642, token: "" },
  { id: "draymond", name: "Draymond", avatar: "🎛️", color: "#22d3ee", tagline: "Orchestrator", protocol: "draymond", host: "127.0.0.1", port: 8644, token: "" },
  { id: "ntfy", name: "NtfyBot", avatar: "🔔", color: "#f472b6", tagline: "Push", protocol: "ntfy", host: "https://ntfy.sh", port: 80, token: "", topic: "approvals" },
];

const SEED_HISTORY = {
  hermes: [
    { id: "hu1", role: "user", text: "hello", time: "10:00", read: true },
    { id: "hb1", role: "bot", text: "Unread hello", time: "10:01" },
  ],
  ntfy: [{ id: "nu1", role: "user", text: "needle in the haystack", time: "11:00", read: true }],
};

function seedStorage() {
  localStorage.setItem(CONF_KEY, JSON.stringify(SEED_BOTS));
  localStorage.setItem(HIST_KEY, JSON.stringify(SEED_HISTORY));
  localStorage.setItem(MODE_KEY, "dev");
}

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Query the Chat panel root (tagged with data-testid="chat-panel"). */
function chatPanel(container) {
  return container.querySelector('[data-testid="chat-panel"]');
}

/** Open the settings panel for an existing bot by clicking its row gear. */
async function openBotSettings(user, name) {
  const row = screen.getByText(name).closest('div[style*="cursor"]');
  await user.click(within(row).getByRole("button"));
}

/** Click the round "+" button in the Inbox header. */
async function clickAddBot(user) {
  const headerBlock = screen
    .getByRole("heading", { name: "Messages" })
    .parentElement.parentElement;
  await user.click(headerBlock.lastElementChild);
}

describe("App.jsx integration", () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    window.confirm = vi.fn(() => true);
    seedStorage();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders the inbox, seeded bots, unread badge and search field", async () => {
    render(<App />);
    await flushPromises();

    expect(
      screen.getByRole("heading", { name: "Messages" })
    ).toBeInTheDocument();
    for (const bot of SEED_BOTS) {
      expect(screen.getByText(bot.name)).toBeInTheDocument();
    }
    expect(screen.getByPlaceholderText("Search agents…")).toBeInTheDocument();
    // hermes has one unread bot message seeded — it is the last message,
    // so the Inbox preview shows the bot text and the unread badge shows 1.
    expect(screen.getByText("Unread hello")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens a chat, marks all messages seen, and persists to storage", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));

    // Chat panel is now visible with the bot header
    expect(await within(chatPanel(container)).findByText("Hermes")).toBeInTheDocument();
    expect(within(chatPanel(container)).getByText("hello")).toBeInTheDocument();
    expect(within(chatPanel(container)).getByText("Unread hello")).toBeInTheDocument();

    // Unread badge cleared + persisted _seen flags
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(HIST_KEY));
      expect(stored.hermes.every((m) => m._seen === true)).toBe(true);
    });
  });

  it("filters the bot list by the search query", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await user.type(screen.getByPlaceholderText("Search agents…"), "Claw");
    expect(screen.getByText("Claw")).toBeInTheDocument();
    expect(screen.queryByText("Hermes")).not.toBeInTheDocument();
    expect(screen.queryByText("Draymond")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search agents…"));
    expect(screen.getByText("Hermes")).toBeInTheDocument();
  });

  it("toggles Basic/Dev mode and persists the mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    expect(screen.getByRole("button", { name: "Switch to Basic mode" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Basic mode" }));
    expect(screen.getByRole("button", { name: "Switch to Dev mode" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(MODE_KEY)).toBe("basic"));

    await user.click(screen.getByRole("button", { name: "Switch to Dev mode" }));
    expect(screen.getByRole("button", { name: "Switch to Basic mode" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(MODE_KEY)).toBe("dev"));
  });

  it("opens Settings, edits the host, and saves & reconnects", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await openBotSettings(user, "Hermes");
    expect(await screen.findByText("Hermes Settings")).toBeInTheDocument();

    const hostInput = screen.getByDisplayValue("127.0.0.1");
    await user.clear(hostInput);
    await user.type(hostInput, "10.0.0.5");

    await user.click(screen.getByRole("button", { name: "Save & Reconnect" }));

    await waitFor(() => {
      expect(screen.queryByText("Hermes Settings")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(CONF_KEY));
      const hermes = stored.find((b) => b.id === "hermes");
      expect(hermes.host).toBe("10.0.0.5");
    });
  });

  it("back button exits Settings to the inbox", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await openBotSettings(user, "Hermes");
    expect(await screen.findByText("Hermes Settings")).toBeInTheDocument();

    const heading = screen.getByText("Hermes Settings");
    const header = heading.parentElement.parentElement;
    await user.click(header.querySelector("button"));

    expect(screen.queryByText("Hermes Settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save & Reconnect" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Messages" })
    ).toBeInTheDocument();
  });

  it("opens and closes every developer-tool modal from Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await openBotSettings(user, "Hermes");
    expect(await screen.findByText("Hermes Settings")).toBeInTheDocument();

    // Audit Log
    await user.click(screen.getByText(/Audit Log & Tool Execution History/));
    expect(await screen.findByRole("heading", { name: "Audit Log" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Audit Log" })).not.toBeInTheDocument();

    // Tool Execution Console
    await user.click(screen.getByText(/Tool Execution Console/));
    expect(await screen.findByRole("heading", { name: "Execute Tool" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Execute Tool" })).not.toBeInTheDocument();

    // Automation Scheduler
    await user.click(screen.getByText(/Automation Scheduler/));
    expect(await screen.findByRole("heading", { name: "Automation Scheduler" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Automation Scheduler" })).not.toBeInTheDocument();

    // Team Management
    await user.click(screen.getByText(/Team Management/));
    expect(await screen.findByRole("heading", { name: "Team Management" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Team Management" })).not.toBeInTheDocument();

    // Developer Panel has no bot selected from Settings, so no modal renders
    await user.click(screen.getByText(/Developer Panel/));
    expect(screen.queryByRole("heading", { name: "Developer Panel" })).not.toBeInTheDocument();
  });

  it("creates a new bot from Settings and it appears in the inbox", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await clickAddBot(user);
    expect(await screen.findByText("New Bot")).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText("My Agent");
    await user.type(nameInput, "Groktest");

    const createButton = screen.getByRole("button", { name: "Create Bot" });
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    expect(await screen.findByText("Groktest")).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(CONF_KEY));
      expect(stored.some((b) => b.name === "Groktest")).toBe(true);
    });
  });

  it("deletes a bot after confirming, and keeps it when cancelled", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();
    await openBotSettings(user, "Hermes");
    await screen.findByText("Hermes Settings");

    // cancel keeps the bot
    window.confirm = vi.fn(() => false);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Hermes")).toBeInTheDocument();
    expect(screen.queryByText("Hermes Settings")).toBeInTheDocument();

    // confirm deletes bot + its history
    window.confirm = vi.fn(() => true);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByText("Hermes")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Hermes Settings")).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(CONF_KEY));
      expect(stored.some((b) => b.id === "hermes")).toBe(false);
    });
  });

  it("sends a message to a Hermes bot and renders the streamed reply", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));
    const input = await within(chatPanel(container)).findByPlaceholderText("Message");

    await user.type(input, "Hello there{Enter}");

    expect(await within(chatPanel(container)).findByText("Hello there")).toBeInTheDocument();
    expect(await within(chatPanel(container)).findByText("assistant reply")).toBeInTheDocument();
    expect(hermesStream).toHaveBeenCalled();
  });

  it("surfaces a stream error as a warning message", async () => {
    const user = userEvent.setup();
    hermesStream.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));
    const input = await within(chatPanel(container)).findByPlaceholderText("Message");
    await user.type(input, "ping{Enter}");

    expect(await within(chatPanel(container)).findByText(/network down/)).toBeInTheDocument();
  });

  it("streams replies for openclaw, subteam, uplift, draymond and ntfy bots", async () => {
    const user = userEvent.setup();
    const cases = [
      { name: "Claw", reply: /claw reply/, userMsg: "hi claw" },
      { name: "SubTeam", reply: /subteam reply/, userMsg: "design a cpu" },
      { name: "Uplift", reply: /bridge reply/, userMsg: "hi uplift" },
      { name: "Draymond", reply: /dray reply/, userMsg: "run pipeline" },
      { name: "NtfyBot", reply: /Published/, userMsg: "notify now" },
    ];

    for (const t of cases) {
      const { container, unmount } = render(<App />);
      await flushPromises();

      await user.click(screen.getByText(t.name));
      const input = await within(chatPanel(container)).findByPlaceholderText("Message");
      await user.type(input, `${t.userMsg}{Enter}`);

      expect(await within(chatPanel(container)).findByText(t.userMsg)).toBeInTheDocument();
      expect(await within(chatPanel(container)).findByText(t.reply)).toBeInTheDocument();
      unmount();
    }
  });

  it("interrupts an in-flight Hermes stream", async () => {
    const user = userEvent.setup();
    let resolveStream;
    hermesStream.mockImplementationOnce(
      () => new Promise((resolve) => { resolveStream = resolve; })
    );
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));
    const input = await within(chatPanel(container)).findByPlaceholderText("Message");
    await user.type(input, "slow mode{Enter}");

    // streaming -> Stop button visible
    const stop = await within(chatPanel(container)).findByRole("button", {
      name: "Stop responding",
    });
    await user.click(stop);

    expect(
      await within(chatPanel(container)).findByRole("button", { name: "Send message" })
    ).toBeInTheDocument();

    act(() => resolveStream && resolveStream("interrupted"));
    await flushPromises();
  });

  it("searches messages and opens the matched chat from SearchResults", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    await user.type(screen.getByPlaceholderText("Search agents…"), "needle");

    // Messages toggle appears once there is a non-empty query
    await user.click(screen.getByRole("button", { name: "Messages" }));

    expect(screen.getByText(/Messages matching/)).toBeInTheDocument();
    expect(screen.getByText("1 result")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /needle in the haystack/ }));

    expect(await within(chatPanel(container)).findByText("NtfyBot")).toBeInTheDocument();
    expect(within(chatPanel(container)).getByText("needle in the haystack")).toBeInTheDocument();
  });

  it("clears the chat via the kebab menu after confirming", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));
    await within(chatPanel(container)).findByText("Unread hello");

    await user.click(screen.getByRole("button", { name: "Chat menu" }));
    await user.click(screen.getByRole("button", { name: "Clear Chat" }));

    expect(await within(chatPanel(container)).findByText(/Connects to Hermes API at/)).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(HIST_KEY));
      expect(stored.hermes).toEqual([]);
    });
  });

  it("deletes a message from the right-click context menu", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));
    await within(chatPanel(container)).findByText("hello");

    fireEvent.contextMenu(within(chatPanel(container)).getByText("hello"));
    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(within(chatPanel(container)).queryByText("hello")).not.toBeInTheDocument();
    });
    expect(within(chatPanel(container)).getByText("Unread hello")).toBeInTheDocument();
  });

  it("closes the chat kebab menu on Escape", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    await user.click(screen.getByText("Hermes"));
    await within(chatPanel(container)).findByText("Unread hello");

    await user.click(screen.getByRole("button", { name: "Chat menu" }));
    expect(screen.getByRole("button", { name: "Clear Chat" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Clear Chat" })).not.toBeInTheDocument();
    });
  });

  it("handles Draymond real-time callbacks: notifications, chains, workflows, agents, tool log", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    const dray = DraymondOrchestratorClient.mock.instances[0];
    expect(dray).toBeDefined();

    act(() => {
      dray.onNotification({ id: "n1", type: "notification", subject: "Deploy ready" });
      dray.onChainUpdate({ chain_instance_id: "c1", type: "chain_started", chain_name: "Build" });
      dray.onWorkflowUpdate({ id: "w1", status: "in_progress" });
      dray.onAgentDiscovered({ id: "a1", name: "Boot Agent" });
      dray.onToolExecution({ executionId: "e1", toolName: "git-cherry", status: "completed", timestamp: Date.now(), parameters: {} });
    });

    // Open Draymond chat: unread notification badge + clear
    await user.click(screen.getByText("Draymond"));
    const bell = await within(chatPanel(container)).findByRole("button", {
      name: "1 unread notifications",
    });
    await user.click(bell);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "1 unread notifications" })).not.toBeInTheDocument();
    });

    // Chain activity strip
    await user.click(within(chatPanel(container)).getByRole("button", { name: "Toggle chain activity" }));
    expect(await within(chatPanel(container)).findByText("Chain Activity")).toBeInTheDocument();
    expect(within(chatPanel(container)).getByText("Build")).toBeInTheDocument();
  });

  it("delivers inbound ntfy messages with dedupe and renders action buttons", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    const ntfy = NtfyClient.mock.instances[0];
    act(() => {
      ntfy.onMessage({ id: "m1", title: "Approval", message: "Approve the run", actions: [{ id: "a1", label: "Approve" }] });
    });
    // duplicate delivery is ignored
    act(() => {
      ntfy.onMessage({ id: "m1", title: "Approval", message: "Approve the run", actions: [{ id: "a1", label: "Approve" }] });
    });

    await user.click(screen.getByText("NtfyBot"));
    expect(await within(chatPanel(container)).findByText(/Approve the run/)).toBeInTheDocument();

    const approve = within(chatPanel(container)).getByRole("button", { name: /Approve/ });
    await user.click(approve);
    expect(await within(chatPanel(container)).findByText(/Done/)).toBeInTheDocument();
    expect(ntfy.executeAction).toHaveBeenCalled();
  });

  it("adds inbound Uplift Bridge messages to the active chat", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    const uplift = UpliftBridgeClient.mock.instances[0];
    act(() => {
      uplift.onInboundMessage({ content: "incoming from bridge" });
    });

    await user.click(screen.getByText("Uplift"));
    expect(await within(chatPanel(container)).findByText(/incoming from bridge/)).toBeInTheDocument();
  });

  it("constructs OpenClaw clients during auto-connect and surfaces send errors", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await flushPromises();

    expect(OpenClawClient).toHaveBeenCalledWith(
      SEED_BOTS.find((b) => b.protocol === "openclaw").host,
      SEED_BOTS.find((b) => b.protocol === "openclaw").port,
      ""
    );
    const claw = OpenClawClient.mock.instances[0];
    expect(claw.connect).toHaveBeenCalled();

    claw.send.mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getByText("Claw"));
    const input = await within(chatPanel(container)).findByPlaceholderText("Message");
    await user.type(input, "x{Enter}");

    expect(await within(chatPanel(container)).findByText(/boom/)).toBeInTheDocument();
  });

  it("manages team spaces through the TeamPanel modal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await openBotSettings(user, "Hermes");
    await screen.findByText("Hermes Settings");
    await user.click(screen.getByText(/Team Management/));
    await screen.findByRole("heading", { name: "Team Management" });

    await user.click(screen.getByRole("button", { name: "+ New Space" }));
    await user.type(screen.getByPlaceholderText("Team space name"), "Shield");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Shield")).toBeInTheDocument();
    expect(screen.getByText("0 members")).toBeInTheDocument();
  });

  it("creates, toggles and deletes automation schedules", async () => {
    const user = userEvent.setup();
    render(<App />);
    await flushPromises();

    await openBotSettings(user, "Hermes");
    await screen.findByText("Hermes Settings");
    await user.click(screen.getByText(/Automation Scheduler/));
    await screen.findByRole("heading", { name: "Automation Scheduler" });

    await user.click(screen.getByRole("button", { name: "+ New Schedule" }));
    await user.type(screen.getByPlaceholderText("Daily backup task"), "Nightly backup");
    await user.type(screen.getByPlaceholderText("backup_messages"), "backup_messages");
    await user.click(screen.getByRole("button", { name: "Create Schedule" }));

    const scheduleName = await screen.findByText("Nightly backup");
    expect(scheduleName).toBeInTheDocument();
    expect(screen.getByText(/Daily at midnight/)).toBeInTheDocument();

    // Invalid parameters path
    await user.click(screen.getByRole("button", { name: "+ New Schedule" }));
    await user.type(screen.getByPlaceholderText("Daily backup task"), "Broken");
    await user.type(screen.getByPlaceholderText("backup_messages"), "act");
    fireEvent.change(screen.getByTestId("schedule-parameters"), {
      target: { value: "{oops" },
    });
    await user.click(screen.getByRole("button", { name: "Create Schedule" }));
    expect(screen.getByText(/Invalid JSON parameters/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
  });
});
