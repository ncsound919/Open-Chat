/**
 * WorkerClient — Open Chat's remote-worker link to Draymond's /api/v1/worker/*
 * endpoints. Task pull/claim/report, skill pack sync, proposals, heartbeat.
 * Reuses the same auth (Bearer CRON_SECRET) as DraymondOrchestratorClient.
 */

const TIMEOUT_MS = 30_000;

export class WorkerClient {
  constructor(baseUrl, token) {
    // baseUrl is Draymond base WITHOUT /api (e.g. http://127.0.0.1:8644)
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.token = token || "";
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

  async pullTasks(workerId = "default", limit = 10) {
    const q = new URLSearchParams({ worker_id: workerId, status: "queued", limit: String(limit) });
    const res = await this._get(`/v1/worker/tasks?${q}`);
    return res.ok ? (res.tasks ?? []) : [];
  }

  async claimTask(taskId, workerId = "default") {
    const res = await this._post(`/v1/worker/tasks/${taskId}/claim`, { worker_id: workerId });
    return res.ok === true;
  }

  async reportTask(taskId, result = {}, artifactRefs = [], error) {
    const res = await this._post(`/v1/worker/tasks/${taskId}/report`, {
      result,
      artifact_refs: artifactRefs,
      error,
      worker_id: this._workerId || "default",
    });
    return res.ok === true;
  }

  async listSkills() {
    const res = await this._get("/v1/worker/skills");
    return res.ok ? (res.skills ?? []) : [];
  }

  async fetchSkill(name, version = "1.0.0") {
    const res = await this._get(`/v1/worker/skills/${encodeURIComponent(name)}:${encodeURIComponent(version)}`);
    return res.ok ? res.skill : null;
  }

  async proposeSkill(workerId, pack) {
    const res = await this._post("/v1/worker/skills", { pack, worker_id: workerId });
    return res.ok === true;
  }

  async heartbeat(workerId, platform = "open-chat", version = "1.0.0") {
    this._workerId = workerId;
    const res = await this._post("/v1/worker/heartbeat", { client_id: workerId, platform, version });
    return res.ok === true;
  }

  async getBriefing(workerId = "default") {
    const q = new URLSearchParams({ worker_id: workerId });
    const res = await this._get(`/v1/worker/briefing?${q}`);
    return res.ok ? (res.tasks ?? []) : [];
  }
}
