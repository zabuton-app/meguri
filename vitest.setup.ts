// Renderer test setup: unmount React trees and reset persisted state between tests.
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("electron-log/renderer", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = vi.fn();
}

// Give scroll/virtualization targets a non-zero viewport in jsdom.
Object.defineProperty(Element.prototype, "clientHeight", {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(Element.prototype, "clientWidth", {
  configurable: true,
  get: () => 1200,
});

// jsdom's HTMLMediaElement is minimal; stub playback so player tests can drive events.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // jsdom may not have localStorage in every config; ignore.
  }
});
