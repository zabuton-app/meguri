// @vitest-environment jsdom
// jsdom, as the other preference tests: happy-dom binds Storage methods per
// instance, so reading back what the provider stored is unreliable there.
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  PreferencesProvider,
  usePreferences,
} from "@/settings/PreferencesProvider";

const LS_KEY = "meguri.prefs";

function wrapper({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

function renderPrefs() {
  return renderHook(() => usePreferences(), { wrapper });
}

function stored(value: unknown) {
  localStorage.setItem(LS_KEY, JSON.stringify({ filmstripFrames: value }));
}

afterEach(() => localStorage.clear());

describe("filmstripFrames preference", () => {
  it("defaults to auto", () => {
    expect(renderPrefs().result.current.filmstripFrames).toBe("auto");
  });

  it("loads a stored count", () => {
    stored(8);
    expect(renderPrefs().result.current.filmstripFrames).toBe(8);
  });

  it("clamps a stored count to 4..24", () => {
    stored(2);
    expect(renderPrefs().result.current.filmstripFrames).toBe(4);
    localStorage.clear();
    stored(99);
    expect(renderPrefs().result.current.filmstripFrames).toBe(24);
  });

  it("reads anything else as auto", () => {
    stored("x");
    expect(renderPrefs().result.current.filmstripFrames).toBe("auto");
  });

  it("persists what the setter is given", () => {
    const { result } = renderPrefs();
    act(() => result.current.setFilmstripFrames(12));
    expect(result.current.filmstripFrames).toBe(12);
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as {
      filmstripFrames?: unknown;
    };
    expect(saved.filmstripFrames).toBe(12);
    act(() => result.current.setFilmstripFrames("auto"));
    expect(result.current.filmstripFrames).toBe("auto");
  });
});
