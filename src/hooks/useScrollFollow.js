import { useRef, useEffect, useLayoutEffect } from "react";

/**
 * Smart auto-scroll that only follows if user is near bottom.
 * Attaches a scroll listener to keep the "near bottom" state accurate
 * even when the user scrolls without triggering a React render.
 * Returns a ref to attach to the scroll container's bottom sentinel element.
 */
export function useScrollFollow(deps = [], threshold = 80) {
  const bottomRef = useRef(null);
  const wasNearBottomRef = useRef(true);

  // Attach a scroll listener to update wasNearBottomRef whenever the user scrolls
  useEffect(() => {
    const element = bottomRef.current;
    if (!element) return;

    const container = element.parentElement;
    if (!container) return;

    const onScroll = () => {
      wasNearBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        threshold;
    };

    // Set initial value
    onScroll();

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [threshold]);

  // Use useLayoutEffect to scroll before the browser paints, avoiding visible jumps.
  // deps is forwarded from the caller; static analysis cannot verify a dynamic array.
  useLayoutEffect(() => {
    if (wasNearBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return bottomRef;
}
