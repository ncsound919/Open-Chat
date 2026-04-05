import { useRef, useEffect } from "react";

/**
 * Smart auto-scroll that only follows if user is near bottom
 * Returns a ref to attach to the scroll container's bottom element
 */
export function useScrollFollow(deps = [], threshold = 80) {
  const bottomRef = useRef(null);
  const wasNearBottomRef = useRef(true);

  useEffect(() => {
    const element = bottomRef.current;
    if (!element) return;

    const container = element.parentElement;
    if (!container) return;

    // Check if user is near bottom before content changes
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold;

    wasNearBottomRef.current = isNearBottom;
  });

  useEffect(() => {
    // Only scroll if user was near bottom
    if (wasNearBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return bottomRef;
}
