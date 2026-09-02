/**
 * fleetControl — the command-center controller over a connected Draymond
 * orchestrator. This is the operator-facing "wake and direct the fleet" API:
 *
 *   ping(slug)        — record a healthy observation (wake a repair-gate
 *                       service / reset its dead-man switch)
 *   markFailed(slug)  — record a failed observation (starts the recovery gate)
 *   gate(slug)        — inspect a repair-gate's current status
 *   direct(id, ...)   — invoke a registry entity/agent with an action + input
 *   recover(id)       — trigger Draymond's recovery protocol for an agent
 *   overview()        — heartbeat triage + orchestrator status + agent roster
 *
 * The controller is bound to a *getter* for the current Draymond client, so it
 * survives bot-swap (the app's single "primary" orchestrator can change
 * without re-creating the controller). Every call fails soft with
 * { ok:false, error } — nothing here can crash the UI or log secrets.
 */

import { safeLog } from "./security.js";

/** Normalize a bare-heartbeat shape into a uniform triage row. */
export function normalizeHeartbeat(slug, hb) {
  const h = typeof hb === "object" && hb !== null ? hb : {};
  return {
    slug,
    up: h.up === true,
    lastSeen: typeof h.last_seen === "string" ? h.last_seen : h.lastSeen ?? null,
    status: typeof h.status === "string" ? h.status : h.up === true ? "online" : "unknown",
    detail: h,
  };
}

/** Count online vs down agents from the heartbeat map. */
export function triageHeartbeats(heartbeats) {
  const rows = Object.entries(heartbeats || {}).map(([slug, hb]) =>
    normalizeHeartbeat(slug, hb)
  );
  return {
    rows,
    up: rows.filter((r) => r.up).length,
    down: rows.filter((r) => !r.up).length,
  };
}

/**
 * Create a fleet controller.
 * @param {() => object|null} getClient - returns the current connected
 *   DraymondOrchestratorClient (or null/undefined when none is connected).
 * @returns {object} controller
 */
export function createFleetController(getClient) {
  const current = () => {
    let c = typeof getClient === "function" ? getClient() : getClient;
    if (c && typeof c.wake === "function") return c;
    return null;
  };

  const fail = (error) => ({ ok: false, error });

  return {
    /** True when a usable orchestrator client is attached. */
    isReady() {
      return current() !== null;
    },

    /** Record a healthy observation for a repair-gate slug (wake it). */
    async ping(slug) {
      const c = current();
      if (!c || !slug) return fail("no connected orchestrator");
      try {
        return await c.wake(slug);
      } catch (err) {
        safeLog("fleet.ping", err);
        return fail(err?.message || "ping failed");
      }
    },

    /** Record a failed observation — trips the recovery gate for a slug. */
    async markFailed(slug) {
      const c = current();
      if (!c || !slug) return fail("no connected orchestrator");
      try {
        return await c.wake(slug, { fail: true });
      } catch (err) {
        safeLog("fleet.markFailed", err);
        return fail(err?.message || "markFailed failed");
      }
    },

    /** Read a repair-gate slug's current status. */
    async gate(slug) {
      const c = current();
      if (!c || !slug) return fail("no connected orchestrator");
      try {
        return (await c.getGateStatus(slug)) ?? { ok: false, error: "gate unknown" };
      } catch (err) {
        safeLog("fleet.gate", err);
        return fail(err?.message || "gate lookup failed");
      }
    },

    /** Directly invoke a registry entity/agent. */
    async direct(id, action, input = {}) {
      const c = current();
      if (!c || !id || !action) return fail("no connected orchestrator");
      try {
        return await c.invokeAgent(id, action, input);
      } catch (err) {
        safeLog("fleet.direct", err);
        return fail(err?.message || "invoke failed");
      }
    },

    /** Trigger Draymond's recovery protocol for an agent. */
    async recover(id) {
      const c = current();
      if (!c || !id) return fail("no connected orchestrator");
      try {
        return await c.recoverAgent(id);
      } catch (err) {
        safeLog("fleet.recover", err);
        return fail(err?.message || "recover failed");
      }
    },

    /** Current registered-agent roster (id → agent). */
    agents() {
      const c = current();
      if (!c || typeof c.getAgents !== "function") return {};
      return c.getAgents() || {};
    },

    /** One-shot fleet picture: heartbeat triage + orchestrator status. */
    async overview() {
      const c = current();
      if (!c) return fail("no connected orchestrator");
      const [heartbeats, status] = await Promise.all([
        c.getHeartbeats ? c.getHeartbeats() : Promise.resolve(null),
        c.getServerStatus ? c.getServerStatus() : Promise.resolve(null),
      ]);
      const triage = triageHeartbeats(heartbeats?.heartbeats ?? heartbeats);
      return {
        ok: true,
        status: status?.status ?? "unreachable",
        triage,
        agents: this.agents(),
      };
    },
  };
}
