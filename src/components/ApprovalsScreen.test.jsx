import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApprovalsScreen, collectApprovalItems } from "./ApprovalsScreen.jsx";

const store = new Map();
function makeLocalStorage() {
  return {
    getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
    setItem: vi.fn((k, v) => store.set(k, String(v))),
    removeItem: vi.fn((k) => store.delete(k)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((i) => Array.from(store.keys())[i] ?? null),
  };
}

const ntfyBot = {
  id: "ntfy1",
  name: "Draymond Approvals",
  protocol: "ntfy",
  color: "#22d3ee",
};

const approvalMsg = {
  id: "m1",
  role: "bot",
  text: "Approve the campaign launch?",
  time: 2000,
  ntfyId: "ntfy-m1",
  actions: [
    { action: "http", label: "Approve", url: "http://x/approve" },
    { action: "http", label: "Reject", url: "http://x/reject" },
  ],
};

beforeEach(() => {
  store.clear();
  global.localStorage = makeLocalStorage();
});

describe("collectApprovalItems", () => {
  it("collects only ntfy messages that carry action buttons", () => {
    const items = collectApprovalItems(
      [ntfyBot, { id: "hermes", protocol: "hermes" }],
      {
        ntfy1: [approvalMsg, { id: "m2", role: "bot", text: "no actions", time: 1 }],
        hermes: [approvalMsg],
      }
    );
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("ntfy-m1");
    expect(items[0].actions).toHaveLength(2);
  });
});

describe("ApprovalsScreen", () => {
  it("renders pending approvals with action buttons", () => {
    render(
      <ApprovalsScreen
        bots={[ntfyBot]}
        history={{ ntfy1: [approvalMsg] }}
        onExecute={vi.fn()}
        onOpenMenu={vi.fn()}
      />
    );
    expect(screen.getByText("Approve the campaign launch?")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Reject")).toBeTruthy();
    expect(screen.getByText("1 pending")).toBeTruthy();
  });

  it("shows an empty state when there are no approvals", () => {
    render(
      <ApprovalsScreen bots={[]} history={{}} onExecute={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(screen.getByText(/No approval requests yet/i)).toBeTruthy();
  });

  it("resolves an approval when the action succeeds", async () => {
    const onExecute = vi.fn(async () => ({ ok: true }));
    render(
      <ApprovalsScreen
        bots={[ntfyBot]}
        history={{ ntfy1: [approvalMsg] }}
        onExecute={onExecute}
        onOpenMenu={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("ntfy1", approvalMsg.actions[0]);
      expect(screen.getByText("0 pending")).toBeTruthy();
      expect(screen.getByText("RESOLVED")).toBeTruthy();
    });
  });

  it("keeps the approval pending and shows an error when the action fails", async () => {
    const onExecute = vi.fn(async () => ({ ok: false, error: "boom" }));
    render(
      <ApprovalsScreen
        bots={[ntfyBot]}
        history={{ ntfy1: [approvalMsg] }}
        onExecute={onExecute}
        onOpenMenu={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Reject"));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByText("1 pending")).toBeTruthy();
  });
});
