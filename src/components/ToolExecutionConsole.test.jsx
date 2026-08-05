import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolExecutionConsole } from "./ToolExecutionConsole.jsx";

describe("ToolExecutionConsole", () => {
  it("executes a tool with parsed parameters and clears the form", async () => {
    const onExecute = vi.fn();
    const user = userEvent.setup();
    render(<ToolExecutionConsole onExecute={onExecute} onClose={vi.fn()} />);

    const nameInput = screen.getByPlaceholderText(/file_read/);
    const params = screen.getByPlaceholderText(/{/);
    fireEvent.change(nameInput, { target: { value: "web_search" } });
    fireEvent.change(params, { target: { value: '{"query":"cats"}' } });
    await user.click(screen.getByRole("button", { name: "Execute" }));

    expect(onExecute).toHaveBeenCalledWith("web_search", { query: "cats" });
    expect(nameInput.value).toBe("");
  });

  it("shows an error when the tool name is empty", async () => {
    const onExecute = vi.fn();
    const user = userEvent.setup();
    render(<ToolExecutionConsole onExecute={onExecute} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Execute" }));
    expect(screen.getByText("Tool name is required")).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("shows an error for invalid JSON parameters", async () => {
    const onExecute = vi.fn();
    const user = userEvent.setup();
    render(<ToolExecutionConsole onExecute={onExecute} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/file_read/), {
      target: { value: "calc" },
    });
    fireEvent.change(screen.getByPlaceholderText(/{/), {
      target: { value: "{bad json" },
    });
    await user.click(screen.getByRole("button", { name: "Execute" }));
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("executes on Cmd/Ctrl+Enter", () => {
    const onExecute = vi.fn();
    render(<ToolExecutionConsole onExecute={onExecute} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/file_read/), {
      target: { value: "file_write" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/{/), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(onExecute).toHaveBeenCalledWith("file_write", {});
  });

  it("closes via the × button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ToolExecutionConsole onExecute={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the Cancel button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ToolExecutionConsole onExecute={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ToolExecutionConsole onExecute={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalled();
  });
});
