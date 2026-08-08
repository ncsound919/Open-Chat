/**
 * WorkerClient — Open Chat's remote-worker link to Draymond's /api/v1/worker/*
 * endpoints. Task pull/claim/report, skill pack sync, proposals, heartbeat.
 * Reuses the same auth (Bearer CRON_SECRET) as DraymondOrchestratorClient.
 *
 * Success shapes: pullTasks/listSkills/getBriefing return arrays,
 * claimTask/reportTask/proposeSkill/heartbeat return booleans.
 * Failures are NOT flattened — methods return { ok: false, error } so callers
 * can distinguish "no work" from "bad token / server down".
 */

const TIMEOUT_MS = 30_000;

export class WorkerClient {
  constructor(baseUrl, token, workerId = "default") {
    // baseUrl is Draymond base WITHOUT /api (e.g. http://127.0.0.1:8644)
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.token = token || "";
    this.workerId = workerId;
  }

  _headers(extra = {}) {
    return {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  async _post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/api${path}`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return data;
    } catch (err) {
      return { ok: false, error: err?.name === "AbortError" ? "timeout" : err?.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async _get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/api${path}`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return data;
    } catch (err) {
      return { ok: false, error: err?.name === "AbortError" ? "timeout" : err?.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async pullTasks(workerId = this.workerId, limit = 10) {
    const q = new URLSearchParams({ worker_id: workerId, status: "queued", limit: String(limit) });
    const res = await this._get(`/v1/worker/tasks?${q}`);
    if (!res.ok) return { ok: false, error: res.error };
    return res.tasks ?? [];
  }

  async claimTask(taskId, workerId = this.workerId) {
    const res = await this._post(`/v1/worker/tasks/${encodeURIComponent(taskId)}/claim`, { worker_id: workerId });
    if (!res.ok) return { ok: false, error: res.error };
    return res.ok === true;
  }

  async reportTask(taskId, result = {}, artifactRefs = [], error, workerId = this.workerId) {
    const res = await this._post(`/v1/worker/tasks/${encodeURIComponent(taskId)}/report`, {
      result,
      artifact_refs: artifactRefs,
      error,
      worker_id: workerId,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return res.ok === true;
  }

  async listSkills() {
    const res = await this._get("/v1/worker/skills");
    if (!res.ok) return { ok: false, error: res.error };
    return res.skills ?? [];
  }

  async fetchSkill(name, version = "1.0.0") {
    const res = await this._get(`/v1/worker/skills/${encodeURIComponent(name)}:${encodeURIComponent(version)}`);
    return res.ok ? res.skill : null;
  }

  async proposeSkill(workerId = this.workerId, pack) {
    const res = await this._post("/v1/worker/skills", { pack, worker_id: workerId });
    if (!res.ok) return { ok: false, error: res.error };
    return res.ok === true;
  }

  async heartbeat(workerId = this.workerId, platform = "open-chat", version = "1.0.0") {
    const res = await this._post("/v1/worker/heartbeat", { client_id: workerId, platform, version });
    if (!res.ok) return { ok: false, error: res.error };
    return res.ok === true;
  }

  async getBriefing(workerId = this.workerId) {
    const q = new URLSearchParams({ worker_id: workerId });
    const res = await this._get(`/v1/worker/briefing?${q}`);
    if (!res.ok) return { ok: false, error: res.error };
    return res.tasks ?? [];
  }
}
