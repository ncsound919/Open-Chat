import { describe, it, expect, vi } from "vitest";
import {
  createFleetController,
  normalizeHeartbeat,
  triageHeartbeats,
} from "./fleetControl.js";

function fakeClient() {
  return {
    wake: vi.fn(async () => ({ ok: true, entry: { healthy: true } })),
    getGateStatus: vi.fn(async () => ({ ok: true, entry: { healthy: false } })),
    invokeAgent: vi.fn(async () => ({ ok: true, result: { text: "done" } })),
    recoverAgent: vi.fn(async () => ({ ok: true, recovery: "started" })),
    getHeartbeats: vi.fn(async () => ({
      heartbeats: { "dca-brain": { up: true }, "hermes": { up: false } },
    })),
    getServerStatus: vi.fn(async () => ({ ok: true, status: "online" })),
    getAgents: vi.fn(() => ({ a1: { id: "a1", name: "Alpha" } })),
  };
}

describe("normalizeHeartbeat / triageHeartbeats", () => {
  it("normalizes up/down rows", () => {
    expect(normalizeHeartbeat("x", { up: true })).toMatchObject({ slug: "x", up: true });
    expect(normalizeHeartbeat("y", { up: false })).toMatchObject({ slug: "y", up: false });
    expect(normalizeHeartbeat("z", null).up).toBe(false);
  });
  it("tallies up/down", () => {
    const t = triageHeartbeats({ a: { up: true }, b: { up: false }, c: {} });
    expect(t.up).toBe(1);
    expect(t.down).toBe(2);
  });
});

describe("createFleetController", () => {
  it("wake / direct / recover delegate to the bound client", async () => {
    const client = fakeClient();
    const fleet = createFleetController(() => client);

    expect((await fleet.ping("openchat")).ok).toBe(true);
    expect(client.wake).toHaveBeenCalledWith("openchat");

    await fleet.markFailed("openchat");
    expect(client.wake).toHaveBeenCalledWith("openchat", { fail: true });

    expect((await fleet.gate("openchat")).ok).toBe(true);
    expect(client.getGateStatus).toHaveBeenCalledWith("openchat");

    expect((await fleet.direct("dca-brain", "chat", { message: "hi" })).ok).toBe(true);
    expect(client.invokeAgent).toHaveBeenCalledWith("dca-brain", "chat", { message: "hi" });

    expect((await fleet.recover("dca-brain")).ok).toBe(true);
    expect(client.recoverAgent).toHaveBeenCalledWith("dca-brain");
  });

  it("overview combines heartbeat triage, status, and agent roster", async () => {
    const client = fakeClient();
    const fleet = createFleetController(() => client);
    const ov = await fleet.overview();
    expect(ov.ok).toBe(true);
    expect(ov.status).toBe("online");
    expect(ov.triage.up).toBe(1);
    expect(ov.triage.down).toBe(1);
    expect(ov.agents.a1.name).toBe("Alpha");
  });

  it("fails soft when no orchestrator is attached", async () => {
    const fleet = createFleetController(() => null);
    expect(fleet.isReady()).toBe(false);
    expect((await fleet.ping("x")).ok).toBe(false);
    expect((await fleet.direct("a", "b")).ok).toBe(false);
    expect((await fleet.overview()).ok).toBe(false);
  });
});
