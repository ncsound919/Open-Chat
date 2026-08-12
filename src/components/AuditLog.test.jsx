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

  it("renders the default status color and icon for unknown statuses", () => {
    render(
      <AuditLog
        toolLog={[{ executionId: "e4", toolName: "mystery", timestamp: 4000, status: "queued" }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("mystery")).toBeInTheDocument();
    expect(screen.getByText("•")).toBeInTheDocument();
  });

  it("renders the success status variant", () => {
    render(
      <AuditLog
        toolLog={[{ executionId: "e5", toolName: "ok", timestamp: 5000, status: "success" }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("shows Unknown Action when neither toolName nor action is present", () => {
    render(
      <AuditLog
        toolLog={[{ executionId: "e6", timestamp: 6000, status: "failed" }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Unknown Action")).toBeInTheDocument();
  });

  it("stringifies non-string results", () => {
    render(
      <AuditLog
        toolLog={[
          {
            executionId: "e7",
            toolName: "obj",
            timestamp: 7000,
            status: "completed",
            result: { ok: true, count: 3 },
          },
        ]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/ok.*true.*count.*3/)).toBeInTheDocument();
  });

  it("matches text filters across tool name, agent id and status", () => {
    render(<AuditLog toolLog={entries} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search by tool, agent, or status/), {
      target: { value: "a1" },
    });
    expect(screen.getByText("1 of 3 entries")).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
  });
});

describe("AuditLog unified trail", () => {
  const notif = {
    type: "notification.sent",
    receivedAt: 4000,
    data: { title: "Sale alert", message: "A payment landed" },
  };
  const chain = {
    type: "chain.completed",
    chain_instance_id: "ci-1",
    chain_slug: "daily-recap",
    ts: 5000,
  };
  const workflow = { id: "wf-1", status: "completed", startTime: 6000 };
  const worker = { id: "w-1", skill_pack_id: "social_post:1.0.0", status: "completed", completed_at: 7000 };

  it("merges notifications, chains, workflows, and worker tasks into the feed", () => {
    render(
      <AuditLog
        toolLog={[]}
        notifications={[notif]}
        chains={[chain]}
        workflows={{ "wf-1": workflow }}
        workerTasks={[worker]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Sale alert")).toBeInTheDocument();
    expect(screen.getByText("Chain: daily-recap")).toBeInTheDocument();
    expect(screen.getByText("Workflow: wf-1")).toBeInTheDocument();
    expect(screen.getByText("Worker task: social_post:1.0.0")).toBeInTheDocument();
    expect(screen.getByText("4 of 4 entries")).toBeInTheDocument();
  });

  it("filters by source using the chip buttons", () => {
    render(
      <AuditLog
        toolLog={entries}
        notifications={[notif]}
        onClose={vi.fn()}
      />
    );
    // 3 tool + 1 notification = 4 total
    expect(screen.getByText("4 of 4 entries")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Notifications"));
    expect(screen.getByText("1 of 4 entries")).toBeInTheDocument();
    expect(screen.getByText("Sale alert")).toBeInTheDocument();
    expect(screen.queryByText("web_search")).not.toBeInTheDocument();
  });

  it("sorts mixed-source entries newest first", () => {
    render(
      <AuditLog
        toolLog={entries} // 1000,2000,3000
        notifications={[notif]} // 4000
        onClose={vi.fn()}
      />
    );
    const sale = screen.getByText("Sale alert");
    const custom = screen.getByText("custom"); // newest tool (3000)
    expect(
      sale.compareDocumentPosition(custom) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
