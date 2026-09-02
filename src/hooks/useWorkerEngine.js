/**
 * useWorkerEngine — React binding for the Draymond worker loop.
 *
 * Creates one WorkerEngine for a connected Draymond bot, starts/stops it with
 * the connection, persists the task + skill lists to localStorage, and exposes
 * reactive state + actions to the Work screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { isNative } from "../utils/platform.js";
import { createWorkerEngine, resolveWorkerBaseUrl } from "../utils/workerEngine.js";

const TASKS_KEY = "openchat_worker_tasks_v1";
const SKILLS_KEY = "openchat_worker_skills_v1";

/** Capacitor Preferences-backed KV store (web falls back to localStorage). */
export function createPreferencesStore() {
  return {
    async get(key) {
      try {
        if (isNative) {
          const { value } = await Preferences.get({ key });
          return value ? JSON.parse(value) : null;
        }
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const raw = JSON.stringify(value);
      if (isNative) {
        await Preferences.set({ key, value: raw });
      } else {
        localStorage.setItem(key, raw);
      }
    },
    async keys() {
      if (isNative) {
        const { keys } = await Preferences.keys();
        return keys ?? [];
      }
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        keys.push(localStorage.key(i));
      }
      return keys;
    },
  };
}

function loadPersisted(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {object} opts
 * @param {object|null} [opts.bot] - the connected Draymond bot (or null)
 * @param {boolean} [opts.enabled] - start the loop when bot is ready
 * @param {object} [opts.deps] - skillExecutors side effects (onSend/onNotify/chat)
 * @param {()=>void} [opts.onTaskResult] - called after a task completes/fails
 */
export function useWorkerEngine({ bot = null, enabled = false, deps = {}, onTaskResult } = {}) {
  const [tasks, setTasks] = useState(() => loadPersisted(TASKS_KEY));
  const [skills, setSkills] = useState(() => loadPersisted(SKILLS_KEY));
  const [status, setStatus] = useState("idle");
  const [lastError, setLastError] = useState(null);
  const [runningTaskId, setRunningTaskId] = useState(null);
  const [lastPullAt, setLastPullAt] = useState(null);

  const engineRef = useRef(null);
  const onTaskResultRef = useRef(onTaskResult);
  onTaskResultRef.current = onTaskResult;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const workerId = bot ? `open-chat-${bot.id}` : "open-chat-idle";

  const stableBot = useMemo(
    () => (bot && bot.protocol === "draymond" ? bot : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bot?.id, bot?.host, bot?.port, bot?.token, bot?.protocol]
  );

  useEffect(() => {
    if (!enabled || !stableBot) {
      engineRef.current?.stop();
      engineRef.current = null;
      setStatus("idle");
      return;
    }

    const engine = createWorkerEngine({
      baseUrl: resolveWorkerBaseUrl(stableBot),
      token: stableBot.token || "",
      workerId: `open-chat-${stableBot.id}`,
      store: createPreferencesStore(),
      deps: depsRef.current,
      onTaskResult: (result) => onTaskResultRef.current?.(result),
    });
    engineRef.current = engine;

    const unsubscribe = engine.subscribe((s) => {
      setTasks(s.tasks);
      setSkills(s.skills);
      setStatus(s.status);
      setLastError(s.lastError);
      setRunningTaskId(s.runningTaskId);
      setLastPullAt(s.lastPullAt);
    });

    engine.start();

    return () => {
      unsubscribe();
      engine.stop();
      engineRef.current = null;
    };
  }, [enabled, stableBot]);

  // Persist lists (bounded) so the Work screen survives reloads.
  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(-100)));
    } catch {
      /* ignore */
    }
  }, [tasks]);
  useEffect(() => {
    try {
      localStorage.setItem(SKILLS_KEY, JSON.stringify(skills.slice(-100)));
    } catch {
      /* ignore */
    }
  }, [skills]);

  const runTask = useCallback(async (taskId) => {
    if (!engineRef.current) return { ok: false, error: "worker not connected" };
    return engineRef.current.runTask(taskId);
  }, []);

  const proposeSkill = useCallback(async (pack) => {
    if (!engineRef.current) return { ok: false, error: "worker not connected" };
    return engineRef.current.proposeSkill(pack);
  }, []);

  const refresh = useCallback(async () => {
    if (!engineRef.current) return;
    await engineRef.current.refreshSkills();
    await engineRef.current.pull?.();
  }, []);

  return {
    tasks,
    skills,
    status,
    lastError,
    runningTaskId,
    lastPullAt,
    workerId,
    runTask,
    proposeSkill,
    refresh,
  };
}
