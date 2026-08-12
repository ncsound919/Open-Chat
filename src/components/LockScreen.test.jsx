import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LockScreen } from "./LockScreen.jsx";

describe("LockScreen", () => {
  it("renders title, passphrase input, and unlock button", () => {
    render(<LockScreen onUnlock={vi.fn()} />);
    expect(screen.getByText("Open Chat")).toBeTruthy();
    expect(screen.getByLabelText("Passphrase")).toBeTruthy();
    expect(screen.getByText("Unlock")).toBeTruthy();
  });

  it("calls onUnlock with the passphrase and does not error when it succeeds", async () => {
    const onUnlock = vi.fn(async () => true);
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "secret" } });
    fireEvent.click(screen.getByText("Unlock"));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("secret"));
  });

  it("shows an error when onUnlock returns false", async () => {
    const onUnlock = vi.fn(async () => false);
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "nope" } });
    fireEvent.click(screen.getByText("Unlock"));

    expect(await screen.findByText(/Wrong passphrase/i)).toBeTruthy();
  });

  it("does not call onUnlock for an empty passphrase", () => {
    const onUnlock = vi.fn(async () => true);
    render(<LockScreen onUnlock={onUnlock} />);

    const btn = screen.getByText("Unlock").closest("button");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onUnlock).not.toHaveBeenCalled();
  });
});
