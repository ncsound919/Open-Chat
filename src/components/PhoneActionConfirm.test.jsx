import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneActionConfirm } from "./PhoneActionConfirm.jsx";

describe("PhoneActionConfirm", () => {
  it("renders nothing when there is no pending request", () => {
    const { container } = render(
      <PhoneActionConfirm request={null} onAllow={vi.fn()} onDeny={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the action description", () => {
    render(
      <PhoneActionConfirm
        request={{ description: 'Tap "Send"', name: "tap" }}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />
    );
    expect(screen.getByText('Tap "Send"')).toBeTruthy();
  });

  it("calls onAllow when Allow is pressed", () => {
    const onAllow = vi.fn();
    render(
      <PhoneActionConfirm
        request={{ description: "Open app com.whatsapp", name: "open_app" }}
        onAllow={onAllow}
        onDeny={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Allow"));
    expect(onAllow).toHaveBeenCalled();
  });

  it("calls onDeny when Deny is pressed", () => {
    const onDeny = vi.fn();
    render(
      <PhoneActionConfirm
        request={{ description: "Type something", name: "type" }}
        onAllow={vi.fn()}
        onDeny={onDeny}
      />
    );
    fireEvent.click(screen.getByText("Deny"));
    expect(onDeny).toHaveBeenCalled();
  });
});
