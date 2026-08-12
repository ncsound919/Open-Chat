import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsScreen } from "./StatsScreen.jsx";

vi.mock("../protocols/HermesClient.js", () => ({
  hermesHealth: vi.fn(async () => ({ status: "ok", platform: "hermes-agent", version: "9.1.0" })),
  hermesHealthDetailed: vi.fn(async () => ({
    status: "ready",
    version: "9.1.0",
    gateway_state: "running",
    active_agents: 1,
    platforms: { telegram: { connected: true }, api: { connected: true } },
  })),
  hermesAgentInfo: vi.fn(async () => ({
    object: "hermes.api_server.capabilities",
    platform: "hermes-agent",
    model: "deepseek-v4-flash",
    features: { chat_completions: true },
  })),
  hermesSkills: vi.fn(async () => [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }]),
}));

vi.mock("../protocols/DraymondOrchestratorClient.js", () => ({
  DraymondOrchestratorClient: class {
    constructor(host, port, token) {
      this.host = host;
      this.port = port;
      this.token = token;
    }
    getServerStatus() {
      return Promise.resolve({
        ok: true,
        status: "online",
        connected_clients: 7,
        uptime_ms: 3_600_000,
      });
    }
    getMissionDashboard() {
      return Promise.resolve({
        revenueUsd: 1250,
        totalMonthlyTarget: 33000,
        byService: {
          aetherdesk: { target: 12000, won: 500, paid: 1250 },
          maas: { target: 12000, won: 0, paid: 0 },
        },
        opportunities: { total: 3, byStage: {} },
        velocity: { leads: 9, won: 2, invoiced: 1, paid: 1 },
      });
    }
    getHeartbeats() {
      return Promise.resolve({
        heartbeats: {
          "sports-steve": { slug: "sports-steve", name: "Sports Steve", up: true, detail: "HTTP 200" },
          "reporank": { slug: "reporank", name: "RepoRank", up: false, detail: "fetch failed" },
        },
      });
    }
  },
}));

const hermesBot = {
  id: "h1",
  name: "Hermes",
  protocol: "hermes",
  host: "127.0.0.1",
  port: 8642,
  token: "tok",
  color: "#22d3ee",
};

const draymondBot = {
  id: "d1",
  name: "Draymond",
  protocol: "draymond",
  host: "127.0.0.1",
  port: 8644,
  token: "tok",
  color: "#818cf8",
};

const baseProps = {
  onOpenMenu: vi.fn(),
  bots: [hermesBot, draymondBot],
  statuses: { h1: "connected", d1: "error" },
  history: { h1: [{}, {}, {}], d1: [{}, {}] }, // 5 messages
  toolLog: [{ executionId: "e1" }, { executionId: "e2" }], // 2 tool calls
  workflows: { w1: {} }, // 1 workflow
  draymondNotifications: Array.from({ length: 8 }, (_, i) => ({ receivedAt: i })), // 8
  agentRegistry: { a1: {}, a2: {}, a3: {} }, // 3 agents
  unread: 6,
};

describe("StatsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fleet rows for every bot", () => {
    render(<StatsScreen {...baseProps} />);
    expect(screen.getByText("Hermes")).toBeTruthy();
    expect(screen.getByText("Draymond")).toBeTruthy();
    expect(screen.getByText("hermes")).toBeTruthy();
    expect(screen.getByText("draymond")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("shows the Hermes agent card with model, version, and skills count", async () => {
    render(<StatsScreen {...baseProps} />);
    expect(await screen.findByText("Hermes Agent")).toBeTruthy();
    expect(screen.getByText("deepseek-v4-flash")).toBeTruthy();
    expect(screen.getByText("9.1.0")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy(); // gateway_state pill
    expect(screen.getByText("4")).toBeTruthy(); // skills count
  });

  it("shows the Draymond orchestrator card with connected clients and uptime", async () => {
    render(<StatsScreen {...baseProps} />);
    expect(await screen.findByText("Orchestrator")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy(); // connected clients
    expect(screen.getByText("1h 0m")).toBeTruthy(); // uptime
  });

  it("renders the revenue pulse (money) section", async () => {
    render(<StatsScreen {...baseProps} />);
    expect(await screen.findByText("Revenue pulse")).toBeTruthy();
    expect(screen.getByText("$1.3k")).toBeTruthy(); // settled revenue ($1250)
    expect(screen.getByText("$33k")).toBeTruthy(); // monthly target
    expect(screen.getByText("9")).toBeTruthy(); // active leads
    expect(screen.getByText(/aetherdesk/)).toBeTruthy();
  });

  it("renders fleet agent triage with up/down counts", async () => {
    render(<StatsScreen {...baseProps} />);
    expect(await screen.findByText("Agent heartbeats")).toBeTruthy();
    expect(screen.getByText("1 up")).toBeTruthy();
    expect(screen.getByText("1 down")).toBeTruthy();
    expect(screen.getByText("RepoRank")).toBeTruthy();
    expect(screen.getByText("fetch failed")).toBeTruthy();
  });

  it("renders activity counters from props", () => {
    render(<StatsScreen {...baseProps} />);
    expect(screen.getByText("messages")).toBeTruthy();
    expect(screen.getByText("tool calls")).toBeTruthy();
    expect(screen.getByText("workflows")).toBeTruthy();
    expect(screen.getByText("notifications")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy(); // messages
    expect(screen.getByText("2")).toBeTruthy(); // tool calls
    expect(screen.getByText("6")).toBeTruthy(); // unread
    expect(screen.getByText("8")).toBeTruthy(); // notifications
  });

  it("shows empty state when no bots configured", () => {
    render(<StatsScreen onOpenMenu={vi.fn()} bots={[]} />);
    expect(screen.getByText(/No agents configured/i)).toBeTruthy();
  });

  it("toggles auto-refresh", () => {
    render(<StatsScreen {...baseProps} />);
    expect(screen.getByText(/Auto-refresh on/i)).toBeTruthy();
  });
});
