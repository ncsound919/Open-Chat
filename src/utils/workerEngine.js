/**
 * workerEngine — Open Chat's remote-worker loop for Draymond.
 *
 * Turns Open Chat into an executor: it pulls due worker tasks, claims them,
 * resolves the referenced skill pack (cached on-device, else fetched), executes
 * the pack through SkillPackRuntime with the on-device tool handlers, and
 * reports the result back to Draymond.
 *
 * Failures are non-fatal: pull/network errors surface as `lastError` state and
 * the loop retries next tick; a crashed task never blocks the queue.
 *
 * createWorkerEngine returns { start, stop, runTask, proposeSkill, subscribe,
 * getState, refreshSkills }. State shape:
 *   { tasks, skills, status, lastError, lastPullAt, runningTaskId }
 */

import { WorkerClient } from "./workerClient.js";
import { LocalSkillLibrary } from "./localSkillLibrary.js";
import { SkillPackRuntime } from "./skillPackRuntime.js";
import { buildSkillExecutors } from "./skillExecutors.js";

export const PULL_INTERVAL_MS = 15_000;
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const DEFAULT_WORKER_ID = "open-chat";

/**
 * Resolve the WorkerClient base URL (WITHOUT /api) from a Draymond bot config.
 * Mirrors DraymondOrchestratorClient's host normalization: full URL → as-is,
 * remote hostname → https://, local host → http://host:port.
 */
export function resolveWorkerBaseUrl(bot) {
  const host = String(bot?.host || "").trim();
  if (!host) return "";
  if (/^https?:\/\//i.test(host)) {
    return host.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  }
  const isLocal =
    ["127.0.0.1", "localhost", "::1"].includes(host.toLowerCase()) ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return isLocal ? `http://${host}:${bot.port || 3444}` : `https://${host}`;
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl - Draymond base URL WITHOUT /api
 * @param {string} [opts.token]
 * @param {string} [opts.workerId]
 * @param {object} [opts.store] - KV store for LocalSkillLibrary (get/set/keys)
 * @param {object} [opts.deps] - side-effect deps for skillExecutors (onSend/onNotify/chat)
 */
export function createWorkerEngine({
  baseUrl,
  token = "",
  workerId = DEFAULT_WORKER_ID,
  store,
  deps = {},
  onTaskResult,
}) {
  const client = new WorkerClient(baseUrl, token, workerId);
  const library = new LocalSkillLibrary(store);
  const runtime = new SkillPackRuntime(buildSkillExecutors(deps));

  let timers = { pull: null, heartbeat: null };
  let running = false;
  let runningTaskId = null;

  let state = {
    tasks: [],
    skills: [],
    status: "idle",
    lastError: null,
    lastPullAt: null,
    runningTaskId: null,
  };
  const listeners = new Set();

  function emit(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function notifyResult(result) {
    if (typeof onTaskResult === "function") onTaskResult(result);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getState() {
    return { ...state };
  }

  function updateTask(id, patch) {
    emit({ tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  async function refreshSkills() {
    const res = await client.listSkills();
    if (res.ok === false) {
      emit({ lastError: `skills: ${res.error}` });
      return state.skills;
    }
    const skills = Array.isArray(res) ? res : res.skills ?? [];
    emit({ skills, lastError: null });
    return state.skills;
  }

  /** Resolve a skill pack for a task: on-device cache first, then fetch. */
  async function resolvePack(task) {
    const packId = String(task.skill_pack_id || "");
    if (!packId) return null;
    const [name, versionRaw] = packId.split(":");
    const version = versionRaw || "1.0.0";
    const cached = await library.get(name, version).catch(() => null);
    if (cached) return cached;
    const pack = await client.fetchSkill(name, version);
    if (!pack) return null;
    await library.cache(name, version, pack).catch(() => {});
    return pack;
  }

  /**
   * Claim + execute + report a task. Safe to call manually (Work screen "Run
   * now") or from the pull loop. Returns { ok, result?, failed?, error? }.
   */
  async function runTask(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: "task not found" };
    if (runningTaskId) return { ok: false, error: "another task is running" };

    runningTaskId = taskId;
    emit({ runningTaskId: taskId, status: "working", lastError: null });

    const finish = (patch) => {
      updateTask(taskId, patch);
      runningTaskId = null;
      emit({ runningTaskId: null, status: "idle" });
    };

    try {
      const claimed = await client.claimTask(taskId);
      if (claimed !== true) {
        // Server refused the claim (already claimed by another worker) or a
        // transport error. Never execute a task we don't own — duplicate
        // side effects (report/send/capture) are worse than a skipped task.
        const claimError =
          claimed && typeof claimed.error === "string"
            ? claimed.error
            : "claim failed — already claimed by another worker";
        finish({ status: "skipped", error: claimError });
        const skipped = { ok: false, taskId, error: claimError };
        notifyResult(skipped);
        return skipped;
      }
      updateTask(taskId, { status: "claimed" });

      if (!task.skill_pack_id) {
        await client.reportTask(taskId, {}, [], "no skill pack assigned");
        finish({ status: "failed", error: "no skill pack assigned" });
        const noPack = { ok: false, taskId, error: "no skill pack assigned" };
        notifyResult(noPack);
        return noPack;
      }

      const pack = await resolvePack(task);
      if (!pack) {
        await client.reportTask(taskId, {}, [], `skill pack not found: ${task.skill_pack_id}`);
        finish({ status: "failed", error: `skill pack not found: ${task.skill_pack_id}` });
        const missing = { ok: false, taskId, error: `skill pack not found: ${task.skill_pack_id}` };
        notifyResult(missing);
        return missing;
      }

      updateTask(taskId, { status: "in_progress" });

      const result = await runtime.execute(pack, {
        ...(task.payload ?? {}),
        task_id: task.id,
      });
      const failedTools = Array.isArray(result.failed) ? result.failed : [];
      const okReport = await client.reportTask(
        taskId,
        { result: result.output, failed: failedTools },
        []
      );
      const error =
        failedTools.length > 0
          ? failedTools.map((f) => `${f.tool}: ${f.error}`).join("; ")
          : null;
      finish({
        status: failedTools.length > 0 ? "failed" : "completed",
        result: result.output,
        error,
      });
      const outcome = { ok: okReport && failedTools.length === 0, taskId, result: result.output, failed: failedTools, error };
      notifyResult(outcome);
      return outcome;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await client.reportTask(taskId, {}, [], msg).catch(() => {});
      finish({ status: "failed", error: msg });
      const failure = { ok: false, taskId, error: msg };
      notifyResult(failure);
      return failure;
    }
  }

  /** Pull due tasks and auto-execute queued ones (serially). */
  async function pull() {
    if (runningTaskId) return;
    const res = await client.pullTasks(undefined, 10);
    if (res.ok === false) {
      emit({ lastError: res.error, status: "error" });
      return;
    }
    const tasks = Array.isArray(res) ? res : [];
    emit({ tasks, status: "connected", lastError: null, lastPullAt: new Date().toISOString() });
    for (const task of tasks) {
      if (task.status === "queued" && !runningTaskId) {
        await runTask(task.id);
      }
    }
  }

  async function heartbeat() {
    await client.heartbeat(workerId, "open-chat", "1.0.0").catch(() => {});
  }

  function start() {
    if (running) return;
    running = true;
    emit({ status: "connecting" });
    void refreshSkills();
    void pull();
    timers.pull = setInterval(() => void pull(), PULL_INTERVAL_MS);
    timers.heartbeat = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (timers.pull) clearInterval(timers.pull);
    if (timers.heartbeat) clearInterval(timers.heartbeat);
    timers = { pull: null, heartbeat: null };
    emit({ status: "stopped" });
  }

  async function proposeSkill(pack) {
    const res = await client.proposeSkill(workerId, pack);
    if (res.ok === false) return { ok: false, error: res.error };
    return { ok: true };
  }

  return { start, stop, runTask, proposeSkill, subscribe, getState, refreshSkills, pull };
}
