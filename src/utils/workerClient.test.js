import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerClient } from "./workerClient.js";

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload };
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

  it("claims a task", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.claimTask("t1", "worker-1");
    expect(ok).toBe(true);
  });

  it("reports a task with artifacts", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.reportTask("t1", { ok: true }, ["uri://a.png"]);
    expect(ok).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.artifact_refs).toEqual(["uri://a.png"]);
  });

  it("fetches and syncs skill packs", async () => {
    fetch.mockResolvedValue(okJson({ ok: true, skill: { name: "social_post", version: "1.0.0", instructions: "post it" } }));
    const skill = await client.fetchSkill("social_post", "1.0.0");
    expect(skill.instructions).toBe("post it");
  });

  it("proposes a new skill", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.proposeSkill("worker-1", { name: "new_skill", version: "0.1.0" });
    expect(ok).toBe(true);
  });

  it("sends a heartbeat", async () => {
    fetch.mockResolvedValue(okJson({ ok: true }));
    const ok = await client.heartbeat("worker-1");
    expect(ok).toBe(true);
  });
});
