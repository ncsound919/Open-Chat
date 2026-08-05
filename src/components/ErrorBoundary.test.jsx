import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

function Bomb({ boom, label = "all good" }) {
  if (boom) throw new Error("kaboom");
  return <div>{label}</div>;
}

function ThrowsPrimitive() {
  throw "raw-string-error";
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children normally", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong")
    ).not.toBeInTheDocument();
  });

  it("shows the fallback and logs to console.error when a child throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb boom />
      </ErrorBoundary>
    );
    expect(errorSpy).toHaveBeenCalled();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument();
  });

  it("re-renders children after the user clicks Try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the child, but the boundary must still be reset to re-mount it.
    rerender(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong")
    ).not.toBeInTheDocument();
  });

  it("shows a generic message when the thrown value has no message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowsPrimitive />
      </ErrorBoundary>
    );
    expect(
      screen.getByText("An unexpected error occurred.")
    ).toBeInTheDocument();
  });
});
