/**
 * Vitest setup — jsdom globals + jest-dom matchers.
 * Run before every test file.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Minimal ResizeObserver stub used by hooks/layout components under jsdom.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// matchMedia stub (used by some responsive logic).
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: String(query),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}
