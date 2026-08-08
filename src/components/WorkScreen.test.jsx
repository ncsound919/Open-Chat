import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
