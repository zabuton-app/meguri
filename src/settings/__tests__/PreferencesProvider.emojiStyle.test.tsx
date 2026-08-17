import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  DEFAULT_EMOJI_STYLE,
  EMOJI_STYLE_OPTIONS,
  isEmojiStyle,
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

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.emojiStyle;
  vi.restoreAllMocks();
});

describe("isEmojiStyle", () => {
  it("accepts every option and rejects everything else", () => {
    for (const s of EMOJI_STYLE_OPTIONS) expect(isEmojiStyle(s)).toBe(true);
    expect(isEmojiStyle("apple")).toBe(false);
    expect(isEmojiStyle(undefined)).toBe(false);
    expect(isEmojiStyle(42)).toBe(false);
  });
});

describe("emojiStyle preference", () => {
  it("defaults to native and mirrors it to <html data-emoji-style> on mount", () => {
    const { result } = renderPrefs();
    expect(result.current.emojiStyle).toBe(DEFAULT_EMOJI_STYLE);
    expect(document.documentElement.dataset.emojiStyle).toBe("native");
  });

  it("loads a valid stored value", () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ emojiStyle: "twemoji" }));
    const { result } = renderPrefs();
    expect(result.current.emojiStyle).toBe("twemoji");
    expect(document.documentElement.dataset.emojiStyle).toBe("twemoji");
  });

  it("falls back to native for an invalid stored value", () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ emojiStyle: "comic-sans" }));
    const { result } = renderPrefs();
    expect(result.current.emojiStyle).toBe("native");
  });

  it("round-trips through localStorage and updates the data attribute", () => {
    const { result } = renderPrefs();
    act(() => result.current.setEmojiStyle("noto"));
    expect(result.current.emojiStyle).toBe("noto");
    expect(document.documentElement.dataset.emojiStyle).toBe("noto");
    expect(
      (
        JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as {
          emojiStyle?: string;
        }
      ).emojiStyle,
    ).toBe("noto");

    // A remount (≒ app restart) restores the choice.
    const remounted = renderPrefs();
    expect(remounted.result.current.emojiStyle).toBe("noto");
  });

  it("preserves unrelated prefs when changing the style", () => {
    const { result } = renderPrefs();
    act(() => result.current.setSceneCount(24));
    act(() => result.current.setEmojiStyle("openmoji"));
    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as {
      sceneCount?: number;
      emojiStyle?: string;
    };
    expect(stored.sceneCount).toBe(24);
    expect(stored.emojiStyle).toBe("openmoji");
  });

  it("writes only the prefs blob — never other storage (FR-005 guard)", () => {
    const { result } = renderPrefs();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    act(() => result.current.setEmojiStyle("twemoji"));
    const keys = new Set(setItem.mock.calls.map(([k]) => k));
    expect([...keys]).toEqual([LS_KEY]);
  });
});
