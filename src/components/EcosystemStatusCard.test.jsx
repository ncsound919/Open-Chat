import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EcosystemStatusCard } from "./EcosystemStatusCard.jsx";

vi.mock("../protocols/DraymondOrchestratorClient.js", () => ({
  DraymondOrchestratorClient: class {
    constructor(host, port, token) {
      this.host = host;
      this.port = port;
      this.token = token;
    }
    getEcosystemStatus() {
      return Promise.resolve({
        ok: true,
        generatedAt: "2026-09-02T00:00:00.000Z",
        narrative:
          "Revenue is $1.3k of the $5k monthly target with 2 of 3 agents up. Marketing is weighted toward listmonk.",
        narrativeSource: "llm",
        mission: {
          revenueUsd: 1250,
          totalMonthlyTarget: 5000,
          gapUsd: 3750,
          byService: {},
          opportunities: { total: 3, byStage: {} },
          velocity: { leads: 9, won: 2, invoiced: 1, paid: 1 },
        },
        fleet: {
          checked: 3,
          up: 2,
          down: 1,
          sweepFresh: true,
          upAgents: [{ slug: "a", name: "Alpha" }, { slug: "b", name: "Beta" }],
          downAgents: [{ slug: "c", name: "Gamma", detail: "fetch failed" }],
          criticalMoments: [
            {
              id: "km_1",
              kind: "stale_heartbeat",
              title: "Agent heartbeat stale: Megacode",
              detail: "down",
              lastSeen: "2026-09-01T23:00:00.000Z",
              occurrences: 3,
            },
          ],
        },
        teams: {
          strategy: {
            monthlyTarget: 5000,
            firstDollarByDay: 30,
            runwayDays: 90,
            services: [
              { id: "maas", name: "Marketing-as-a-Service", targetMonthly: 2000 },
              { id: "audit", name: "Codebase Audit & QA", targetMonthly: 1000 },
            ],
          },
          marketing: {
            generatedAt: "2026-09-02T00:00:00.000Z",
            recommended: "listmonk",
            rationale: "Owned audience, highest LTV.",
            guard: { allowed: true, reason: "Channel mix approved." },
            allocation: [],
          },
        },
        actions: [
          { priority: "critical", text: "Agent heartbeat stale: Megacode — down" },
          { priority: "warn", text: "No active leads in the pipeline." },
        ],
      });
    }
  },
}));

const draymondBot = {
  id: "d1",
  name: "Draymond",
  protocol: "draymond",
  host: "127.0.0.1",
  port: 8644,
  token: "tok",
};

describe("EcosystemStatusCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pulls and renders the narrative paragraph, KPIs, teams, and actions", async () => {
    render(<EcosystemStatusCard bot={draymondBot} autoRefreshDefault={false} />);

    expect(await screen.findByText(/Revenue is \$1\.3k/)).toBeTruthy();
    expect(screen.getByText("monthly target")).toBeTruthy(); // KPI label (exact)
    expect(screen.getByText("$5k")).toBeTruthy(); // target
    expect(screen.getByText("$1.3k")).toBeTruthy(); // settled revenue
    expect(screen.getByText("$3.8k")).toBeTruthy(); // gap (3750)
    expect(screen.getByText("2/3")).toBeTruthy(); // agents up
    expect(screen.getByText("1")).toBeTruthy(); // critical alerts
    expect(screen.getByText("listmonk")).toBeTruthy(); // marketing focus
    expect(screen.getByText("Fresh")).toBeTruthy(); // monitor

    expect(screen.getByText(/Marketing-as-a-Service/)).toBeTruthy();
    expect(screen.getByText("live")).toBeTruthy(); // narrativeSource pill

    expect(screen.getByText(/Agent heartbeat stale: Megacode/)).toBeTruthy();
    expect(screen.getByText(/No active leads/)).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy(); // down agent
  });

  it("re-pulls on button push", async () => {
    render(<EcosystemStatusCard bot={draymondBot} autoRefreshDefault={false} />);
    await screen.findByText(/Revenue is \$1\.3k/);
    fireEvent.click(screen.getByText("Pull status"));
    await waitFor(() => expect(screen.getByText(/Revenue is \$1\.3k/)).toBeTruthy());
  });

  it("toggles auto-refresh", async () => {
    render(<EcosystemStatusCard bot={draymondBot} autoRefreshDefault={true} />);
    await screen.findByText(/Revenue is \$1\.3k/);
    expect(screen.getByText("Auto on")).toBeTruthy();
    fireEvent.click(screen.getByText("Auto on"));
    expect(screen.getByText("Auto off")).toBeTruthy();
  });

  it("shows an error state when no bot is connected", () => {
    render(<EcosystemStatusCard bot={null} autoRefreshDefault={false} />);
    expect(screen.getByText(/No Draymond orchestrator connected/)).toBeTruthy();
  });
});