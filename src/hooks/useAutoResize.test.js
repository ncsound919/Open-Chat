import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoResize } from "./useAutoResize.js";

describe("useAutoResize", () => {
  it("returns a ref object", () => {
    const { result } = renderHook(() => useAutoResize("", 120));
    expect(result.current).toBeInstanceOf(Object);
    expect(result.current).toHaveProperty("current", null);
  });

  it("sizes the attached element to its scrollHeight", () => {
    const { result, rerender } = renderHook(
      ({ value, maxHeight }) => useAutoResize(value, maxHeight),
      { initialProps: { value: "a", maxHeight: 120 } }
    );
    const el = { style: {}, scrollHeight: 50 };
    result.current.current = el;
    rerender({ value: "a longer value", maxHeight: 120 });
    expect(el.style.height).toBe("50px");
  });

  it("caps the height at maxHeight", () => {
    const { result, rerender } = renderHook(
      ({ value, maxHeight }) => useAutoResize(value, maxHeight),
      { initialProps: { value: "a", maxHeight: 120 } }
    );
    const el = { style: {}, scrollHeight: 1000 };
    result.current.current = el;
    rerender({ value: "b", maxHeight: 120 });
    expect(el.style.height).toBe("120px");
  });

  it("respects a custom maxHeight", () => {
    const { result, rerender } = renderHook(
      ({ value, maxHeight }) => useAutoResize(value, maxHeight),
      { initialProps: { value: "a", maxHeight: 60 } }
    );
    const el = { style: {}, scrollHeight: 100 };
    result.current.current = el;
    rerender({ value: "b", maxHeight: 60 });
    expect(el.style.height).toBe("60px");
  });

  it("does nothing while no element is attached", () => {
    const { rerender } = renderHook(
      ({ value, maxHeight }) => useAutoResize(value, maxHeight),
      { initialProps: { value: "a", maxHeight: 120 } }
    );
    expect(() => rerender({ value: "b", maxHeight: 120 })).not.toThrow();
  });
});
