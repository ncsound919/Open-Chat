import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuditLog } from "./AuditLog.jsx";

const entries = [
  {
    executionId: "e1",
    toolName: "web_search",
    agentId: "a1",
    status: "completed",
    timestamp: 1000,
    parameters: { q: "x" },
    result: "found it",
  },
  {
    executionId: "e2",
    toolName: "file_read",
    agentId: "a2",
    status: "failed",
    timestamp: 2000,
    error: "Permission denied",
  },
  {
    action: "custom",
    timestamp: 3000,
    status: "in_progress",
  },
];

describe("AuditLog", () => {
  it("renders the header and sorts entries newest-first", () => {
    render(<AuditLog toolLog={entries} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Audit Log" })).toBeInTheDocument();
    expect(screen.getByText("3 of 3 entries")).toBeInTheDocument();

    const custom = screen.getByText("custom");
    const fileRead = screen.getByText("file_read");
    const webSearch = screen.getByText("web_search");
    expect(
      custom.compareDocumentPosition(fileRead) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      fileRead.compareDocumentPosition(webSearch) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders tool names, agent ids, timestamps, parameters, results and errors", () => {
    render(<AuditLog toolLog={entries} onClose={vi.fn()} />);
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByText("file_read")).toBeInTheDocument();
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.getByText("a2")).toBeInTheDocument();
    expect(screen.getByText(/found it/)).toBeInTheDocument();
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
    expect(screen.getByText(/"q": "x"/)).toBeInTheDocument();
  });

  it("filters entries by search text", () => {
    render(<AuditLog toolLog={entries} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search by tool, agent, or status/), {
      target: { value: "web_search" },
    });
    expect(screen.getByText("1 of 3 entries")).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.queryByText("file_read")).not.toBeInTheDocument();
  });

  it("filters entries by type", () => {
    render(<AuditLog toolLog={entries} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "error" } });
    expect(screen.getByText("1 of 3 entries")).toBeInTheDocument();
    expect(screen.getByText("file_read")).toBeInTheDocument();
    expect(screen.queryByText("web_search")).not.toBeInTheDocument();
  });

  it("shows the empty message when there are no entries", () => {
    render(<AuditLog toolLog={[]} onClose={vi.fn()} />);
    expect(screen.getByText("No audit log entries yet")).toBeInTheDocument();
  });

  it("shows the no-matches message when filters exclude everything", () => {
    render(<AuditLog toolLog={entries} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search by tool, agent, or status/), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No entries match your filters")).toBeInTheDocument();
  });

  it("closes via the × button", () => {
    const onClose = vi.fn();
    render(<AuditLog toolLog={entries} onClose={onClose} />);
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the Close button", () => {
    const onClose = vi.fn();
    render(<AuditLog toolLog={entries} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<AuditLog toolLog={entries} onClose={onClose} />);
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalled();
  });
});
