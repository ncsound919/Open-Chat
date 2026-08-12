import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkScreen } from "./WorkScreen.jsx";

describe("WorkScreen", () => {
  it("renders queued tasks, skill library, and propose action", () => {
    render(
      <WorkScreen
        tasks={[{ id: "t1", skill_pack_id: "social_post:1.0.0", status: "queued" }]}
        localSkills={["social_post:1.0.0", "open_app"]}
        onProposeSkill={() => {}}
        onRunTask={() => {}}
        onOpenMenu={() => {}}
      />
    );
    expect(screen.getByText(/t1/)).toBeTruthy();
    expect(screen.getByText(/social_post:1.0.0/)).toBeTruthy();
    expect(screen.getByText(/Propose skill/i)).toBeTruthy();
  });

  it("shows empty states when no tasks or skills", () => {
    render(
      <WorkScreen
        tasks={[]}
        localSkills={[]}
        onProposeSkill={() => {}}
        onRunTask={() => {}}
        onOpenMenu={() => {}}
      />
    );
    expect(screen.getByText(/No tasks assigned yet/i)).toBeTruthy();
    expect(screen.getByText(/No skills cached yet/i)).toBeTruthy();
  });

  it("shows Run now only for queued tasks and invokes onRunTask", () => {
    const onRunTask = vi.fn();
    render(
      <WorkScreen
        tasks={[
          { id: "t1", skill_pack_id: "a:1.0.0", status: "queued" },
          { id: "t2", skill_pack_id: "b:1.0.0", status: "claimed" },
        ]}
        localSkills={[]}
        onProposeSkill={() => {}}
        onRunTask={onRunTask}
        onOpenMenu={() => {}}
      />
    );
    const runButtons = screen.getAllByText(/Run now/i);
    expect(runButtons.length).toBe(1);
    fireEvent.click(runButtons[0]);
    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("does not crash when onProposeSkill is omitted", () => {
    render(
      <WorkScreen
        tasks={[]}
        localSkills={[]}
        onRunTask={() => {}}
        onOpenMenu={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/Propose skill/i));
    expect(screen.getByText(/No tasks assigned yet/i)).toBeTruthy();
  });

  it("falls back to asap for missing due_at", () => {
    render(
      <WorkScreen
        tasks={[{ id: "t1", skill_pack_id: "a:1.0.0", status: "completed" }]}
        localSkills={[]}
        onProposeSkill={() => {}}
        onRunTask={() => {}}
        onOpenMenu={() => {}}
      />
    );
    expect(screen.getByText(/due: asap/i)).toBeTruthy();
  });

  it("shows the worker status line and last error", () => {
    render(
      <WorkScreen
        tasks={[]}
        localSkills={[]}
        status="connected"
        workerId="open-chat-abc"
        lastError="bad token"
        onProposeSkill={() => {}}
        onRunTask={() => {}}
        onOpenMenu={() => {}}
      />
    );
    expect(screen.getByText(/Worker connected/i)).toBeTruthy();
    expect(screen.getByText(/open-chat-abc/)).toBeTruthy();
    expect(screen.getByText(/bad token/)).toBeTruthy();
  });

  it("invokes onRefresh from the refresh button", () => {
    const onRefresh = vi.fn();
    render(
      <WorkScreen
        tasks={[]}
        localSkills={[]}
        status="connected"
        onProposeSkill={() => {}}
        onRunTask={() => {}}
        onRefresh={onRefresh}
        onOpenMenu={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Refresh tasks/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("submits a skill proposal from the propose form", async () => {
    const onProposeSkill = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WorkScreen
        tasks={[]}
        localSkills={[]}
        onProposeSkill={onProposeSkill}
        onRunTask={() => {}}
        onOpenMenu={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/Propose skill/i));
    const nameInput = screen.getByPlaceholderText(/Skill name/);
    fireEvent.change(nameInput, { target: { value: "daily_report" } });
    fireEvent.change(screen.getByPlaceholderText(/Purpose/), {
      target: { value: "Build a daily report" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Tools/), {
      target: { value: "capture, text" },
    });
    fireEvent.click(screen.getByText(/Submit proposal/i));
    expect(onProposeSkill).toHaveBeenCalledTimes(1);
    expect(onProposeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "daily_report",
        purpose: "Build a daily report",
        tools: ["capture", "text"],
      })
    );
  });
});
