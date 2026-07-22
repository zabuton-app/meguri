import { describe, expect, it } from "vitest";
import {
  isHelpKey,
  matchAny,
  matchChord,
  type KeyChord,
} from "@/settings/keybindings";

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

  describe("isHelpKey", () => {
    it("matches Shift+Slash (US layout, key '?')", () => {
      expect(
        isHelpKey(keyEvent({ code: "Slash", key: "?", shiftKey: true })),
      ).toBe(true);
    });

    it("matches by produced '?' char even when code is not Slash (AZERTY etc.)", () => {
      expect(
        isHelpKey(keyEvent({ code: "Comma", key: "?", shiftKey: true })),
      ).toBe(true);
    });

    it("ignores plain Slash without shift", () => {
      expect(isHelpKey(keyEvent({ code: "Slash", key: "/" }))).toBe(false);
    });

    it("ignores '?' combined with a modifier", () => {
      expect(
        isHelpKey(
          keyEvent({ code: "Slash", key: "?", shiftKey: true, ctrlKey: true }),
        ),
      ).toBe(false);
    });

    it("allows '?' typed via AltGr (reported as Ctrl+Alt)", () => {
      expect(
        isHelpKey(
          keyEvent({
            code: "KeyM",
            key: "?",
            ctrlKey: true,
            altKey: true,
            modifierAltGraph: true,
          }),
        ),
      ).toBe(true);
    });

    it("falls back to Shift+Slash by code when key does not surface '?'", () => {
      expect(
        isHelpKey(keyEvent({ code: "Slash", key: "Process", shiftKey: true })),
      ).toBe(true);
    });

    it("rejects the code fallback when a modifier is held", () => {
      expect(
        isHelpKey(
          keyEvent({
            code: "Slash",
            key: "Process",
            shiftKey: true,
            ctrlKey: true,
          }),
        ),
      ).toBe(false);
    });
  });

  it("matches tinykeys sequence strings with cached state", () => {
    const chords: KeyChord[] = ["KeyG KeyI"];

    expect(matchAny(keyEvent({ code: "KeyG", key: "g" }), chords)).toBe(false);
    expect(matchAny(keyEvent({ code: "KeyI", key: "i" }), chords)).toBe(true);
  });
});
