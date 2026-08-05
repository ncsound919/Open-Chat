import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings.jsx";
import { MODES } from "../utils/modeConfig.js";

const hermesBot = {
  id: "b1",
  name: "Hermes Bot",
  avatar: "🤖",
  color: "#22d3ee",
  tagline: "tag",
  protocol: "hermes",
  host: "127.0.0.1",
  port: 8642,
  token: "secret123",
  topic: "",
  voiceEnabled: false,
  voiceBackend: "draymond",
};

function devProps(overrides = {}) {
  return {
    bot: hermesBot,
    isNew: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onBack: vi.fn(),
    mode: MODES.DEV,
    onOpenAuditLog: vi.fn(),
    onOpenToolConsole: vi.fn(),
    onOpenDevPanel: vi.fn(),
    onOpenTeamPanel: vi.fn(),
    onOpenScheduler: vi.fn(),
    draymondNotifications: [],
    ...overrides,
  };
}

describe("Settings header and basic form (Dev mode)", () => {
  it("renders the bot name and protocol label", () => {
    render(<Settings {...devProps()} />);
    expect(screen.getByText("Hermes Bot Settings")).toBeInTheDocument();
    expect(screen.getByText("Hermes HTTP")).toBeInTheDocument();
  });

  it("displays host, port, token fields and the masked token", () => {
    render(<Settings {...devProps()} />);
    expect(screen.getByDisplayValue("127.0.0.1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8642")).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret123")).toBeInTheDocument();
    expect(screen.getByText(/Stored as:/)).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    const { container } = render(<Settings {...devProps({ onBack })} />);
    fireEvent.click(container.querySelector("button"));
    expect(onBack).toHaveBeenCalled();
  });

  it("calls onDelete when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(<Settings {...devProps({ onDelete })} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("edits the host and saves the updated form", () => {
    const onSave = vi.fn();
    render(<Settings {...devProps({ onSave })} />);
    fireEvent.change(screen.getByDisplayValue("127.0.0.1"), {
      target: { value: "localhost" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & Reconnect" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ host: "localhost" }));
  });

  it("toggles the voiceEnabled checkbox", () => {
    const onSave = vi.fn();
    render(<Settings {...devProps({ onSave })} />);
    const voice = screen.getByLabelText("Enable voice for this bot");
    fireEvent.click(voice);
    fireEvent.click(screen.getByRole("button", { name: "Save & Reconnect" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ voiceEnabled: true }));
  });

  it("changes the protocol select and updates the connection info", () => {
    const onSave = vi.fn();
    render(
      <Settings
        {...devProps({
          bot: hermesBot,
          isNew: true,
          mode: MODES.DEV,
          onSave,
        })}
      />
    );
    const protocol = screen
      .getAllByRole("combobox")
      .find((s) => s.value === "hermes");
    fireEvent.change(protocol, {
      target: { value: "openclaw" },
    });
    expect(screen.getByText("OpenClaw WebSocket")).toBeInTheDocument();
    expect(screen.getByText(/ws:\/\//)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Bot" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ protocol: "openclaw" }));
  });

  it("shows the non-localhost security warning", () => {
    render(<Settings {...devProps({ bot: { ...hermesBot, host: "example.com" } })} />);
    expect(screen.getByText(/Non-localhost host detected/)).toBeInTheDocument();
  });

  it("shows the remote tunnel notice for a Draymond host", () => {
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond", host: "tunnel.example.com" },
        })}
      />
    );
    expect(screen.getByText(/Remote tunnel detected/)).toBeInTheDocument();
  });

  it("shows protocol-specific token labels for uplift-bridge and ntfy", () => {
    const { unmount } = render(
      <Settings {...devProps({ bot: { ...hermesBot, protocol: "uplift-bridge" } })} />
    );
    expect(screen.getByText("UPLIFT_OAUTH_TOKEN")).toBeInTheDocument();
    unmount();
    render(<Settings {...devProps({ bot: { ...hermesBot, protocol: "ntfy" } })} />);
    expect(screen.getByText("NTFY_ACCESS_TOKEN (optional)")).toBeInTheDocument();
  });

  it("shows the topic field for an ntfy bot", () => {
    render(
      <Settings {...devProps({ bot: { ...hermesBot, protocol: "ntfy", topic: "approvals" } })} />
    );
    expect(screen.getByDisplayValue("approvals")).toBeInTheDocument();
  });

  it("renders the AetherDesk API key field in dev mode", () => {
    render(<Settings {...devProps()} />);
    expect(screen.getByPlaceholderText(/x-api-key/)).toBeInTheDocument();
  });
});

describe("Settings developer tool buttons", () => {
  function renderWithAll() {
    const props = devProps();
    render(<Settings {...props} />);
    return props;
  }

  it("opens the Audit Log, Tool Console, Dev Panel, Scheduler and Team Panel", () => {
    const props = renderWithAll();
    fireEvent.click(screen.getByRole("button", { name: /Audit Log & Tool Execution History/ }));
    expect(props.onOpenAuditLog).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Tool Execution Console/ }));
    expect(props.onOpenToolConsole).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Developer Panel/ }));
    expect(props.onOpenDevPanel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Automation Scheduler/ }));
    expect(props.onOpenScheduler).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Team Management/ }));
    expect(props.onOpenTeamPanel).toHaveBeenCalled();
  });

  it("hides tool buttons whose callbacks are not provided", () => {
    render(
      <Settings {...devProps({ onOpenAuditLog: undefined, onOpenDevPanel: undefined })} />
    );
    expect(screen.queryByRole("button", { name: /Audit Log/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Developer Panel/ })).not.toBeInTheDocument();
  });
});

describe("Settings Draymond remote management", () => {
  function draymondClientMock(status = "connected", { chainError, scheduleError } = {}) {
    return {
      status,
      listChains: vi.fn(async () =>
        chainError ? Promise.reject(new Error("chains down")) : [{ slug: "gold", name: "Gold", description: "g" }]
      ),
      listSchedules: vi.fn(async () =>
        scheduleError ? Promise.reject(new Error("sched down")) : [{ job_name: "job1", cron: "* * * * *", enabled: true }]
      ),
      executeChain: vi.fn(async () => {
        if (chainError) throw new Error("chain exec down");
      }),
      toggleSchedule: vi.fn(async () => {
        if (scheduleError) throw new Error("toggle down");
      }),
    };
  }

  it("fetches and renders chains and schedules from a connected client", async () => {
    const draymondClient = draymondClientMock();
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond" },
          draymondClient,
        })}
      />
    );
    await waitFor(() => expect(screen.getByText("Gold")).toBeInTheDocument());
    expect(screen.getByText("job1")).toBeInTheDocument();
    expect(draymondClient.listChains).toHaveBeenCalled();
    expect(draymondClient.listSchedules).toHaveBeenCalled();
  });

  it("runs a chain and toggles a schedule", async () => {
    const draymondClient = draymondClientMock();
    const user = userEvent.setup();
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond" },
          draymondClient,
        })}
      />
    );
    await waitFor(() => expect(screen.getByText("Gold")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(draymondClient.executeChain).toHaveBeenCalledWith("gold");

    await user.click(screen.getByRole("button", { name: "On" }));
    expect(draymondClient.toggleSchedule).toHaveBeenCalledWith("job1", false);
    expect(screen.getByRole("button", { name: "Off" })).toBeInTheDocument();
  });

  it("shows empty state when the server returns no chains or schedules", async () => {
    const draymondClient = {
      status: "connected",
      listChains: vi.fn(async () => ({ chains: [] })),
      listSchedules: vi.fn(async () => ({ schedules: [] })),
    };
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond" },
          draymondClient,
        })}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("No chains found on server.")).toBeInTheDocument()
    );
    expect(screen.getByText("No schedules found on server.")).toBeInTheDocument();
  });

  it("logs errors when chain/schedule operations fail", async () => {
    const draymondClient = {
      status: "connected",
      listChains: vi.fn(async () => [{ slug: "gold", name: "Gold" }]),
      listSchedules: vi.fn(async () => [{ job_name: "job1", enabled: true }]),
      executeChain: vi.fn(async () => {
        throw new Error("chain exec down");
      }),
      toggleSchedule: vi.fn(async () => {
        throw new Error("toggle down");
      }),
    };
    const user = userEvent.setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond" },
          draymondClient,
        })}
      />
    );
    await waitFor(() => expect(screen.getByText("Gold")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(screen.getByRole("button", { name: "On" }));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not fetch when the draymond client is not connected", async () => {
    const draymondClient = draymondClientMock("disconnected");
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond" },
          draymondClient,
        })}
      />
    );
    expect(draymondClient.listChains).not.toHaveBeenCalled();
    expect(draymondClient.listSchedules).not.toHaveBeenCalled();
  });

  it("toggles the notification history", async () => {
    const user = userEvent.setup();
    const draymondNotifications = [
      { type: "notification_sent", subject: "Approval ready", recipient: "me@x.com", receivedAt: 0 },
      { type: "notification_failed", subject: "Failed one" },
    ];
    render(
      <Settings
        {...devProps({
          bot: { ...hermesBot, protocol: "draymond" },
          draymondClient: draymondClientMock(),
          draymondNotifications,
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: /Recent Notifications/ }));
    expect(screen.getByText("Approval ready")).toBeInTheDocument();
    expect(screen.getByText(/To: me@x.com/)).toBeInTheDocument();
    expect(screen.getByText("Failed one")).toBeInTheDocument();
  });
});

describe("Settings new bot", () => {
  const emptyBot = { name: "", avatar: "🤖", color: "#22d3ee" };

  it("pre-fills mode defaults in basic mode and hides advanced fields", () => {
    render(<Settings {...devProps({ bot: emptyBot, isNew: true, mode: MODES.BASIC })} />);
    expect(screen.getByText("New Bot")).toBeInTheDocument();
    expect(screen.getByText("Display Name")).toBeInTheDocument();
    expect(screen.getByText("Avatar Emoji")).toBeInTheDocument();
    expect(screen.getByText("Accent Color")).toBeInTheDocument();
    expect(screen.queryByText("Protocol")).not.toBeInTheDocument();
    expect(screen.queryByText("Host")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Bot" })).toBeDisabled();
  });

  it("creates a bot once a name is entered", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <Settings {...devProps({ bot: emptyBot, isNew: true, mode: MODES.BASIC, onSave })} />
    );
    const nameInput = screen.getByPlaceholderText("My Agent");
    await user.type(nameInput, "My New Bot");
    await user.click(screen.getByRole("button", { name: "Create Bot" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My New Bot",
        protocol: "hermes",
        host: "127.0.0.1",
        port: 8642,
        token: "",
      })
    );
  });

  it("updates avatar and color before saving in basic mode", async () => {
    const onSave = vi.fn();
    render(
      <Settings {...devProps({ bot: emptyBot, isNew: true, mode: MODES.BASIC, onSave })} />
    );
    fireEvent.change(screen.getByPlaceholderText("My Agent"), {
      target: { value: "ColorBot" },
    });
    fireEvent.change(screen.getByPlaceholderText("🤖"), { target: { value: "🚀" } });
    fireEvent.change(document.querySelector('input[type="color"]'), {
      target: { value: "#ff0000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Bot" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: "🚀", color: "#ff0000" })
    );
  });

  it("shows the protocol select and advanced fields in dev mode", () => {
    render(
      <Settings
        {...devProps({
          bot: { ...emptyBot, protocol: "hermes" },
          isNew: true,
          mode: MODES.DEV,
        })}
      />
    );
    const protocol = screen
      .getAllByRole("combobox")
      .find((s) => s.value === "hermes");
    expect(protocol).toBeInTheDocument();
    for (const value of ["hermes", "openclaw", "uplift-bridge", "subteam", "draymond", "ntfy"]) {
      expect(protocol.querySelector(`option[value="${value}"]`)).not.toBeNull();
    }
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Port")).toBeInTheDocument();
    expect(screen.getByText("API_SERVER_KEY")).toBeInTheDocument();
  });
});
