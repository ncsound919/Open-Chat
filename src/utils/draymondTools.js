/**
 * draymondTools — Draymond skill tools exposed to the on-device agent.
 *
 * Lets the local model act as a control surface for the Draymond ecosystem
 * mid-conversation: list skill packs, run one on-device, run a remote chain,
 * or enqueue a task for another worker. Each tool returns a serializable
 * `{ ok, ... }` object the chat tool-calling loop feeds back to the model.
 */

import { WorkerClient } from "./workerClient.js";
import { LocalSkillLibrary } from "./localSkillLibrary.js";
import { SkillPackRuntime } from "./skillPackRuntime.js";
import { buildSkillExecutors } from "./skillExecutors.js";

/**
 * @param {object} opts
 * @param {string} opts.baseUrl - Draymond base URL WITHOUT /api
 * @param {string} [opts.token]
 * @param {string} [opts.workerId]
 * @param {object} [opts.store] - KV store for LocalSkillLibrary
 * @param {object} [opts.orchestrator] - optional DraymondOrchestratorClient (used by run_chain)
 * @param {object} [opts.deps] - skillExecutors side effects
 * @returns {{ tools: Array, handler: (name:string,args:object)=>Promise<object> }}
 */
export function buildDraymondTools({ baseUrl, token, workerId, store, orchestrator, deps = {} }) {
  const client = new WorkerClient(baseUrl, token, workerId);
  const library = new LocalSkillLibrary(store);
  const runtime = new SkillPackRuntime(buildSkillExecutors(deps));

  async function runSkill(args) {
    const packRef = String(args?.skill ?? args?.name ?? "");
    if (!packRef) return { ok: false, error: "skill name required (e.g. bookbridge_search:1.0.0)" };
    const [name, versionRaw] = packRef.split(":");
    const version = versionRaw || "1.0.0";
    const cached = await library.get(name, version).catch(() => null);
    const pack = cached ?? (await client.fetchSkill(name, version));
    if (!pack) return { ok: false, error: `skill pack not found: ${packRef}` };
    const res = await runtime.execute(pack, { ...(args?.payload ?? {}), args });
    const failedTools = Array.isArray(res.failed) ? res.failed : [];
    return {
      ok: failedTools.length === 0,
      pack: `${pack.name}:${pack.version}`,
      output: res.output,
      failed: failedTools,
    };
  }

  async function runChain(args) {
    const slug = String(args?.slug ?? args?.chain ?? "");
    if (!slug) return { ok: false, error: "chain slug required" };
    if (orchestrator?.executeChain) {
      try {
        const res = await orchestrator.executeChain(slug, args?.input ?? {});
        return { ok: res?.ok !== false, result: res };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    try {
      const res = await fetch(`${baseUrl}/api/v1/chains`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ chain_slug: slug, input: args?.input ?? {} }),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, result: data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function listSkills() {
    const res = await client.listSkills();
    if (res.ok === false) return { ok: false, error: res.error };
    return {
      ok: true,
      skills: (res ?? []).map((s) => ({
        name: s.name,
        version: s.version,
        purpose: s.purpose ?? "",
        tools: s.tools ?? [],
      })),
    };
  }

  async function enqueueTask(args) {
    const skillPackId = args?.skill_pack_id ?? args?.skill ?? null;
    const res = await client.enqueueTask(skillPackId, args?.payload ?? {}, args?.due_at);
    if (res.ok === false) return { ok: false, error: res.error };
    return { ok: true, task_id: res.id };
  }

  const handler = async (name, args) => {
    switch (name) {
      case "list_skills":
        return listSkills();
      case "run_skill":
        return runSkill(args ?? {});
      case "run_chain":
        return runChain(args ?? {});
      case "enqueue_task":
        return enqueueTask(args ?? {});
      default:
        return { ok: false, error: `unknown draymond tool: ${name}` };
    }
  };

  const tools = [
    {
      name: "list_skills",
      description: "List skill packs available on the connected Draymond orchestrator.",
      parameters: {},
    },
    {
      name: "run_skill",
      description:
        "Run a Draymond skill pack on this device. args: { skill: 'name' or 'name:version', payload: {...} }.",
      parameters: {
        skill: { type: "string", description: "Skill pack name, optionally with :version" },
        payload: { type: "object", description: "Task payload for the pack" },
      },
    },
    {
      name: "run_chain",
      description: "Execute a Draymond chain by slug. args: { slug, input: {...} }.",
      parameters: {
        slug: { type: "string", description: "Chain slug (e.g. research-pipeline)" },
        input: { type: "object", description: "Chain input" },
      },
    },
    {
      name: "enqueue_task",
      description:
        "Queue a worker task on Draymond for a remote worker to execute. args: { skill_pack_id, payload: {...}, due_at }.",
      parameters: {
        skill_pack_id: { type: "string", description: "Skill pack id (name:version)" },
        payload: { type: "object", description: "Task payload" },
      },
    },
  ];

  return { tools, handler };
}

/** Draymond tool names, for membership checks in the model client. */
export const DRAYMOND_TOOL_NAMES = ["list_skills", "run_skill", "run_chain", "enqueue_task"];
