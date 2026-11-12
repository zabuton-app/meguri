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

// The preload hands down the app's name, which locale strings interpolate as
// {app}, and its one-character mark. Mocked here rather than through window.api, which stays undefined so
// the IPC client keeps its no-preload fallback.
vi.mock("@/lib/appName", () => ({
  appName: vi.fn(() => "Meguri"),
  appGlyph: vi.fn(() => "巡"),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = vi.fn();
}

// Give scroll/virtualization targets a non-zero viewport. jsdom defines these on
// Element.prototype and happy-dom on HTMLElement.prototype; stub whichever owns
// them, so a test can still narrow them on that same prototype.
const viewportProto = Object.hasOwn(HTMLElement.prototype, "clientWidth")
  ? HTMLElement.prototype
  : Element.prototype;
Object.defineProperty(viewportProto, "clientHeight", {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(viewportProto, "clientWidth", {
  configurable: true,
  get: () => 1200,
});

// The test DOM's HTMLMediaElement does not play media; stub playback so player tests can drive events.
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
    // The test DOM may not have localStorage in every config; ignore.
  }
});
