import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollFollow } from "./useScrollFollow.js";

function makeSentinel({ scrollHeight = 500, scrollTop = 0, clientHeight = 450 } = {}) {
  const container = {
    scrollHeight,
    scrollTop,
    clientHeight,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const sentinel = {
    parentElement: container,
    scrollIntoView: vi.fn(),
  };
  return { container, sentinel };
}

describe("useScrollFollow", () => {
  it("returns a bottom ref, attaches a scroll listener, and scrolls into view when near the bottom", () => {
    // 500 - 0 - 450 = 50px from the bottom — within the 80px threshold.
    const { container, sentinel } = makeSentinel();
    const { result, unmount, rerender } = renderHook(
      ({ deps, threshold }) => useScrollFollow(deps, threshold),
      { initialProps: { deps: [0], threshold: 80 } }
    );

    expect(result.current).toBeInstanceOf(Object);
    expect(result.current).toHaveProperty("current", null);

    result.current.current = sentinel;
    // Change the threshold so the listener-attaching effect re-runs now that
    // the ref is populated.
    rerender({ deps: [1], threshold: 120 });

    expect(container.addEventListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      { passive: true }
    );
    expect(sentinel.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });

    const onScroll = container.addEventListener.mock.calls[0][1];
    unmount();
    expect(container.removeEventListener).toHaveBeenCalledWith("scroll", onScroll);
  });

  it("does not scroll into view when the user is far from the bottom", () => {
    // 900px from the bottom — well past the 80px threshold.
    const { container, sentinel } = makeSentinel({
      scrollHeight: 1000,
      scrollTop: 0,
      clientHeight: 100,
    });
    const { result, rerender } = renderHook(
      ({ deps, threshold }) => useScrollFollow(deps, threshold),
      { initialProps: { deps: [0], threshold: 80 } }
    );

    result.current.current = sentinel;
    rerender({ deps: [1], threshold: 120 });

    // Simulate a user scroll while far from the bottom, then a dependency
    // update that would normally trigger a follow.
    const onScroll = container.addEventListener.mock.calls[0][1];
    sentinel.scrollIntoView.mockClear();
    onScroll();

    rerender({ deps: [2], threshold: 120 });
    expect(sentinel.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not throw when no element is attached", () => {
    const { result, rerender } = renderHook(
      ({ deps, threshold }) => useScrollFollow(deps, threshold),
      { initialProps: { deps: [0], threshold: 80 } }
    );
    expect(() => rerender({ deps: [1], threshold: 120 })).not.toThrow();
    expect(result.current).toHaveProperty("current", null);
  });
});
