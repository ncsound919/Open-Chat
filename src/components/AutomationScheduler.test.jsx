import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationScheduler } from "./AutomationScheduler.jsx";

function renderScheduler(props = {}) {
  return render(
    <AutomationScheduler
      schedules={[]}
      onCreateSchedule={vi.fn()}
      onUpdateSchedule={vi.fn()}
      onDeleteSchedule={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

function openCreateForm() {
  fireEvent.click(screen.getByRole("button", { name: "+ New Schedule" }));
}

describe("AutomationScheduler empty state", () => {
  it("renders the header and empty message", () => {
    renderScheduler();
    expect(
      screen.getByRole("heading", { name: "Automation Scheduler" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No scheduled tasks yet. Create one to automate your workflows."
      )
    ).toBeInTheDocument();
  });
});

describe("AutomationScheduler schedule list", () => {
  const schedules = [
    { id: "s1", name: "Daily", cronExpression: "0 0 * * *", action: "backup", parameters: {}, enabled: true },
    { id: "s2", name: "Hourly", cronExpression: "0 * * * *", action: "ping", parameters: null, enabled: false },
    { id: "s3", name: "Five", cronExpression: "*/5 * * * *", action: "scan", parameters: { a: 1 }, enabled: true },
    { id: "s4", name: "Weekly", cronExpression: "0 0 * * 0", action: "report", parameters: undefined, enabled: false },
    { id: "s5", name: "Monthly", cronExpression: "0 0 1 * *", action: "audit", parameters: {}, enabled: true },
    { id: "s6", name: "Custom", cronExpression: "0 0 * * 1", action: "custom", parameters: {}, enabled: true },
    { id: "s7", name: "Broken", cronExpression: "bad", action: "oops", parameters: {}, enabled: true },
  ];

  it("renders each schedule with its cron description and action", () => {
    renderScheduler({ schedules });
    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.getByText("Daily at midnight • backup")).toBeInTheDocument();
    expect(screen.getByText("Every hour • ping")).toBeInTheDocument();
    expect(screen.getByText("Every 5 minutes • scan")).toBeInTheDocument();
    expect(screen.getByText("Weekly on Sunday • report")).toBeInTheDocument();
    expect(screen.getByText("Monthly on the 1st • audit")).toBeInTheDocument();
    expect(screen.getByText("0 0 * * 1 • custom")).toBeInTheDocument();
    expect(screen.getByText("Invalid cron expression • oops")).toBeInTheDocument();
  });

  it("shows parameters only when non-empty", () => {
    renderScheduler({ schedules });
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.queryByText("{}")).not.toBeInTheDocument();
  });

  it("toggles a schedule from enabled to disabled", () => {
    const onUpdateSchedule = vi.fn();
    renderScheduler({ schedules, onUpdateSchedule });
    fireEvent.click(screen.getAllByRole("button", { name: "Enabled" })[0]);
    expect(onUpdateSchedule).toHaveBeenCalledWith("s1", {
      ...schedules[0],
      enabled: false,
    });
  });

  it("toggles a schedule from disabled to enabled", () => {
    const onUpdateSchedule = vi.fn();
    renderScheduler({ schedules, onUpdateSchedule });
    fireEvent.click(screen.getAllByRole("button", { name: "Disabled" })[0]);
    expect(onUpdateSchedule).toHaveBeenCalledWith("s2", {
      ...schedules[1],
      enabled: true,
    });
  });

  it("deletes a schedule via its × button", () => {
    const onDeleteSchedule = vi.fn();
    renderScheduler({ schedules, onDeleteSchedule });
    const deleteButtons = screen.getAllByText("×");
    fireEvent.click(deleteButtons[1]);
    expect(onDeleteSchedule).toHaveBeenCalledWith("s1");
  });
});

describe("AutomationScheduler create form", () => {
  it("opens and closes the create form with the + New Schedule button", () => {
    renderScheduler();
    expect(screen.queryByPlaceholderText("Daily backup task")).not.toBeInTheDocument();
    openCreateForm();
    expect(screen.getByPlaceholderText("Daily backup task")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ New Schedule" }));
    expect(screen.queryByPlaceholderText("Daily backup task")).not.toBeInTheDocument();
  });

  it("requires a schedule name", () => {
    const onCreateSchedule = vi.fn();
    renderScheduler({ onCreateSchedule });
    openCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));
    expect(screen.getByText("Schedule name is required")).toBeInTheDocument();
    expect(onCreateSchedule).not.toHaveBeenCalled();
  });

  it("requires an action", () => {
    const onCreateSchedule = vi.fn();
    renderScheduler({ onCreateSchedule });
    openCreateForm();
    fireEvent.change(screen.getByPlaceholderText("Daily backup task"), {
      target: { value: "My Task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));
    expect(screen.getByText("Action is required")).toBeInTheDocument();
    expect(onCreateSchedule).not.toHaveBeenCalled();
  });

  it("shows an error for invalid JSON parameters", () => {
    const onCreateSchedule = vi.fn();
    renderScheduler({ onCreateSchedule });
    openCreateForm();
    fireEvent.change(screen.getByPlaceholderText("Daily backup task"), {
      target: { value: "My Task" },
    });
    fireEvent.change(screen.getByPlaceholderText("backup_messages"), {
      target: { value: "backup_messages" },
    });
    fireEvent.change(screen.getByTestId("schedule-parameters"), {
      target: { value: "{bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));
    expect(screen.getByText(/Invalid JSON parameters/)).toBeInTheDocument();
    expect(onCreateSchedule).not.toHaveBeenCalled();
  });

  it("creates a schedule with parsed parameters and resets the form", () => {
    const onCreateSchedule = vi.fn();
    renderScheduler({ onCreateSchedule });
    openCreateForm();
    fireEvent.change(screen.getByPlaceholderText("Daily backup task"), {
      target: { value: "My Task" },
    });
    fireEvent.change(screen.getByPlaceholderText("backup_messages"), {
      target: { value: "backup_messages" },
    });
    fireEvent.change(screen.getByTestId("schedule-parameters"), {
      target: { value: '{"dest": "backups/"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));

    expect(onCreateSchedule).toHaveBeenCalledTimes(1);
    const call = onCreateSchedule.mock.calls[0][0];
    expect(call.name).toBe("My Task");
    expect(call.action).toBe("backup_messages");
    expect(call.cronExpression).toBe("0 0 * * *");
    expect(call.enabled).toBe(true);
    expect(call.parameters).toEqual({ dest: "backups/" });
    expect(typeof call.id).toBe("string");
    expect(typeof call.createdAt).toBe("number");
    expect(screen.queryByPlaceholderText("Daily backup task")).not.toBeInTheDocument();
  });

  it("supports changing the cron expression in the create form", () => {
    const onCreateSchedule = vi.fn();
    renderScheduler({ onCreateSchedule });
    openCreateForm();
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "0 0 1 * *" } });
    fireEvent.change(screen.getByPlaceholderText("Daily backup task"), {
      target: { value: "Monthly Task" },
    });
    fireEvent.change(screen.getByPlaceholderText("backup_messages"), {
      target: { value: "audit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));
    expect(onCreateSchedule.mock.calls[0][0].cronExpression).toBe("0 0 1 * *");
  });

  it("cancels the create form and clears any error", () => {
    renderScheduler();
    openCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));
    expect(screen.getByText("Schedule name is required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Daily backup task")).not.toBeInTheDocument();
    expect(screen.queryByText("Schedule name is required")).not.toBeInTheDocument();
  });
});

describe("AutomationScheduler close", () => {
  it("closes via the × button", () => {
    const onClose = vi.fn();
    renderScheduler({ onClose });
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the Close button", () => {
    const onClose = vi.fn();
    renderScheduler({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = renderScheduler({ onClose });
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalled();
  });
});
