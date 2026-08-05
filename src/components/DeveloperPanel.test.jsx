import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeveloperPanel } from "./DeveloperPanel.jsx";

const bot = {
  id: "b1",
  name: "Bob",
  avatar: "🤖",
  color: "#22d3ee",
  protocol: "hermes",
  host: "127.0.0.1",
  port: 8642,
  token: "tok",
};

function getTextarea() {
  return screen.getByDisplayValue(/Bob/);
}

describe("DeveloperPanel config tab", () => {
  it("renders the header and prefilled config JSON", () => {
    render(<DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Developer Panel" })
    ).toBeInTheDocument();
    expect(getTextarea()).toBeInTheDocument();
  });

  it("saves a valid config through onUpdateBot", async () => {
    const onUpdateBot = vi.fn();
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={onUpdateBot} onClose={vi.fn()} />);
    fireEvent.change(getTextarea(), {
      target: { value: '{"id":"b1","name":"Renamed","protocol":"hermes"}' },
    });
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));
    expect(onUpdateBot).toHaveBeenCalledWith({
      id: "b1",
      name: "Renamed",
      protocol: "hermes",
    });
  });

  it("shows an error for invalid JSON", async () => {
    const onUpdateBot = vi.fn();
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={onUpdateBot} onClose={vi.fn()} />);
    fireEvent.change(getTextarea(), { target: { value: "{broken" } });
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
    expect(onUpdateBot).not.toHaveBeenCalled();
  });

  it("shows an error when required fields are missing", async () => {
    const onUpdateBot = vi.fn();
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={onUpdateBot} onClose={vi.fn()} />);
    fireEvent.change(getTextarea(), {
      target: { value: '{"id":"b1","protocol":"hermes"}' },
    });
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));
    expect(screen.getByText(/Missing required fields/)).toBeInTheDocument();
    expect(onUpdateBot).not.toHaveBeenCalled();
  });
});

describe("DeveloperPanel tabs", () => {
  it("switches to the logs tab", async () => {
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "logs" }));
    expect(screen.getByLabelText("Auto-scroll")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Logs" })).toBeInTheDocument();
    expect(screen.getByText(/No logs yet/)).toBeInTheDocument();
  });

  it("switches to the models tab", async () => {
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "models" }));
    expect(screen.getByText("Default Model")).toBeInTheDocument();
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText("Max Tokens")).toBeInTheDocument();
  });

  it("switches to the webhooks tab", async () => {
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "webhooks" }));
    expect(screen.getByPlaceholderText(/webhook/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Test Request" })).toBeInTheDocument();
  });
});

describe("DeveloperPanel close", () => {
  it("closes via the × button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the Close button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <DeveloperPanel bot={bot} onUpdateBot={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalled();
  });
});
