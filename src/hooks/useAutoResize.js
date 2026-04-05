import { useRef, useEffect } from "react";

/**
 * Auto-resize textarea based on content
 * Returns a ref to attach to the textarea
 */
export function useAutoResize(value, maxHeight = 120) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reset height to auto to get the correct scrollHeight
    el.style.height = "auto";
    // Set height to scrollHeight, capped at maxHeight
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [value, maxHeight]);

  return ref;
}
