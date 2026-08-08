import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerClient } from "./workerClient.js";

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function errJson(status, payload) {
  return { ok: false, status, json: async () => payload };
}

function abortError() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

describe("WorkerClient", () => {
  let client;
  beforeEach(() => {
    client = new WorkerClient("http://127.0.0.1:8644", "tok");
    global.fetch = vi.fn();
  });

  it("pulls due tasks", async () => {
    fetch.mockResolvedValue(okJson({ ok: true, tasks: [{ id: "t1", skill_pack_id: "social_post:1.0.0" }] }));
    const tasks = await client.pullTasks("worker-1");
    expect(tasks.length).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/worker/tasks?worker_id=worker-1&status=queued"),
      expect.any(Object)
    );
  });

  it("returns {ok:false,error} when pulling tasks is rejected", async () => {
    fetch.mockResolvedValue(errJson(401, { error: "Unauthorized" }));
    const res = await client.pullTasks("worker-1");
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("claims a task", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.claimTask("t1", "worker-1");
    expect(ok).toBe(true);
  });

  it("returns {ok:false,error} when claiming fails", async () => {
    fetch.mockResolvedValue(errJson(409, { error: "task not claimable" }));
    const res = await client.claimTask("t1", "worker-1");
    expect(res).toEqual({ ok: false, error: "task not claimable" });
  });

  it("reports a task with artifacts", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.reportTask("t1", { ok: true }, ["uri://a.png"]);
    expect(ok).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.artifact_refs).toEqual(["uri://a.png"]);
  });

  it("includes worker_id from constructor, overridable per call", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const c = new WorkerClient("http://127.0.0.1:8644", "tok", "phone-9");
    await c.reportTask("t1", { ok: true });
    expect(JSON.parse(fetch.mock.calls[0][1].body).worker_id).toBe("phone-9");
    await c.reportTask("t1", { ok: true }, [], undefined, "other-worker");
    expect(JSON.parse(fetch.mock.calls[1][1].body).worker_id).toBe("other-worker");
  });

  it("returns {ok:false,error} when reporting fails", async () => {
    fetch.mockResolvedValue(errJson(401, { error: "Unauthorized" }));
    const res = await client.reportTask("t1", {});
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("URL-encodes task ids in claim and report paths", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    await client.claimTask("a/b c", "worker-1");
    expect(fetch.mock.calls[0][0]).toContain(`/api/v1/worker/tasks/${encodeURIComponent("a/b c")}/claim`);
    await client.reportTask("a/b c", {});
    expect(fetch.mock.calls[1][0]).toContain(`/api/v1/worker/tasks/${encodeURIComponent("a/b c")}/report`);
  });

  it("fetches a skill pack", async () => {
    fetch.mockResolvedValue(okJson({ ok: true, skill: { name: "social_post", version: "1.0.0", instructions: "post it" } }));
    const skill = await client.fetchSkill("social_post", "1.0.0");
    expect(skill.instructions).toBe("post it");
  });

  it("lists skills on success", async () => {
    fetch.mockResolvedValue(okJson({ ok: true, skills: [{ name: "social_post", version: "1.0.0" }] }));
    const skills = await client.listSkills();
    expect(skills).toEqual([{ name: "social_post", version: "1.0.0" }]);
  });

  it("returns {ok:false,error} when listing skills fails", async () => {
    fetch.mockResolvedValue(errJson(401, { error: "Unauthorized" }));
    const res = await client.listSkills();
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("proposes a new skill", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.proposeSkill("worker-1", { name: "new_skill", version: "0.1.0" });
    expect(ok).toBe(true);
  });

  it("returns {ok:false,error} when proposing fails", async () => {
    fetch.mockResolvedValue(errJson(400, { error: "pack.name required" }));
    const res = await client.proposeSkill("worker-1", {});
    expect(res).toEqual({ ok: false, error: "pack.name required" });
  });

  it("sends a heartbeat", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.heartbeat("worker-1");
    expect(ok).toBe(true);
  });

  it("uses resolved workerId without side effects", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.heartbeat();
    expect(ok).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).client_id).toBe("default");
    expect(client.workerId).toBe("default");
    expect(client._workerId).toBeUndefined();
  });

  it("returns {ok:false,error} when heartbeat fails", async () => {
    fetch.mockResolvedValue(errJson(401, { error: "Unauthorized" }));
    const res = await client.heartbeat("worker-1");
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("gets a briefing on success", async () => {
    fetch.mockResolvedValue(okJson({ ok: true, tasks: [{ id: "t1", status: "completed" }] }));
    const tasks = await client.getBriefing("worker-1");
    expect(tasks).toEqual([{ id: "t1", status: "completed" }]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/worker/briefing?worker_id=worker-1"),
      expect.any(Object)
    );
  });

  it("returns {ok:false,error} when briefing fails", async () => {
    fetch.mockResolvedValue(errJson(401, { error: "Unauthorized" }));
    const res = await client.getBriefing("worker-1");
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns {ok:false,error:HTTP n} on non-JSON error body", async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => {
      throw new Error("not json");
    } });
    const res = await client.listSkills();
    expect(res).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("returns {ok:false,error} on network failure", async () => {
    fetch.mockRejectedValue(new Error("fetch failed"));
    const res = await client.getBriefing("worker-1");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/fetch failed/);
  });

  it("returns {ok:false,error:timeout} on abort", async () => {
    fetch.mockRejectedValue(abortError());
    const res = await client.pullTasks("worker-1");
    expect(res).toEqual({ ok: false, error: "timeout" });
  });
});
