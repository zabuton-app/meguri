import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSelectAllGuard } from "@/hooks/useSelectAllGuard";

function pressSelectAll(init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    key: "a",
    code: "KeyA",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(e);
  return e;
}

/** Focus a throwaway element and remove it once the test is done. */
function focusTemp(el: HTMLElement): HTMLElement {
  document.body.appendChild(el);
  el.focus();
  return el;
}

describe("useSelectAllGuard", () => {
  it("suppresses Ctrl+A when nothing is focused", () => {
    renderHook(() => useSelectAllGuard());
    expect(pressSelectAll().defaultPrevented).toBe(true);
  });

  it("suppresses Cmd+A too (macOS)", () => {
    renderHook(() => useSelectAllGuard());
    const e = pressSelectAll({ ctrlKey: false, metaKey: true });
    expect(e.defaultPrevented).toBe(true);
  });

  it("suppresses Ctrl+A where the A label is not KeyA (AZERTY)", () => {
    renderHook(() => useSelectAllGuard());
    // On fr layouts the key labelled "A" is physically KeyQ but still types "a",
    // and Chromium's select-all follows the character.
    expect(pressSelectAll({ code: "KeyQ" }).defaultPrevented).toBe(true);
  });

  it("leaves the letter that shares KeyA on other layouts alone", () => {
    renderHook(() => useSelectAllGuard());
    // The mirror of the case above: on fr layouts Ctrl+Q types "q" on KeyA.
    expect(pressSelectAll({ key: "q", code: "KeyA" }).defaultPrevented).toBe(
      false,
    );
  });

  it("still falls back to the physical key when no character is produced", () => {
    renderHook(() => useSelectAllGuard());
    // Dead keys / IME composition surface key as "Dead", "Process", …
    expect(pressSelectAll({ key: "Process" }).defaultPrevented).toBe(true);
  });

  it("survives a listener that stops propagation", () => {
    renderHook(() => useSelectAllGuard());
    const stop = (e: Event) => e.stopPropagation();
    document.addEventListener("keydown", stop, true);
    try {
      expect(pressSelectAll().defaultPrevented).toBe(true);
    } finally {
      document.removeEventListener("keydown", stop, true);
    }
  });

  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
  ])("leaves Ctrl+A alone inside a %s", (_name, make) => {
    const el = focusTemp(make());
    renderHook(() => useSelectAllGuard());
    try {
      expect(pressSelectAll().defaultPrevented).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("leaves Ctrl+A alone inside a contenteditable", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(el, "isContentEditable", { value: true });
    el.tabIndex = 0;
    focusTemp(el);
    renderHook(() => useSelectAllGuard());
    try {
      expect(pressSelectAll().defaultPrevented).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("ignores other keys and unmodified A", () => {
    renderHook(() => useSelectAllGuard());
    expect(pressSelectAll({ ctrlKey: false }).defaultPrevented).toBe(false);
    expect(pressSelectAll({ key: "k", code: "KeyK" }).defaultPrevented).toBe(
      false,
    );
  });

  it("leaves other chords on the same key free for future bindings", () => {
    renderHook(() => useSelectAllGuard());
    expect(pressSelectAll({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressSelectAll({ altKey: true }).defaultPrevented).toBe(false);
  });

  it("stops guarding once unmounted", () => {
    const { unmount } = renderHook(() => useSelectAllGuard());
    unmount();
    expect(pressSelectAll().defaultPrevented).toBe(false);
  });
});
