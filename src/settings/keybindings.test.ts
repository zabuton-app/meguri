import { describe, expect, it } from "vitest";
import { matchAny, matchChord, type KeyChord } from "@/settings/keybindings";

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    key: init.key ?? init.code,
    ...init,
  });
}

describe("keybindings", () => {
  it("matches existing object chords through tinykeys", () => {
    expect(
      matchChord(keyEvent({ code: "BracketLeft", key: "[" }), {
        code: "BracketLeft",
      }),
    ).toBe(true);
    expect(
      matchChord(keyEvent({ code: "KeyF", key: "f", ctrlKey: true }), {
        code: "KeyF",
        ctrl: true,
      }),
    ).toBe(true);
    expect(
      matchChord(keyEvent({ code: "KeyF", key: "f", metaKey: true }), {
        code: "KeyF",
        ctrl: true,
      }),
    ).toBe(true);
    expect(
      matchChord(keyEvent({ code: "KeyF", key: "f" }), {
        code: "KeyF",
        ctrl: true,
      }),
    ).toBe(false);
  });

  it("keeps shift optional unless explicitly configured", () => {
    expect(
      matchChord(keyEvent({ code: "Slash", key: "/" }), { code: "Slash" }),
    ).toBe(true);
    expect(
      matchChord(keyEvent({ code: "Slash", key: "?", shiftKey: true }), {
        code: "Slash",
      }),
    ).toBe(true);
    expect(
      matchChord(keyEvent({ code: "Slash", key: "?", shiftKey: true }), {
        code: "Slash",
        shift: false,
      }),
    ).toBe(false);
    expect(
      matchChord(keyEvent({ code: "Slash", key: "?", shiftKey: true }), {
        code: "Slash",
        shift: true,
      }),
    ).toBe(true);
  });

  it("matches tinykeys sequence strings with cached state", () => {
    const chords: KeyChord[] = ["KeyG KeyI"];

    expect(matchAny(keyEvent({ code: "KeyG", key: "g" }), chords)).toBe(false);
    expect(matchAny(keyEvent({ code: "KeyI", key: "i" }), chords)).toBe(true);
  });
});
