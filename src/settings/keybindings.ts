// Keyboard binding presets for file paging (prev/next in the detail view).
// Data-driven so the player can also consult them to avoid double-handling a key.
import {
  createKeybindingsHandler,
  matchKeyBindingPress,
  parseKeybinding,
} from "tinykeys";

export type KeybindingPreset = "normal" | "vim" | "emacs";

export const KEYBINDING_PRESETS: KeybindingPreset[] = [
  "normal",
  "vim",
  "emacs",
];

export const DEFAULT_KEYBINDING_PRESET: KeybindingPreset = "normal";

export function isKeybindingPreset(v: unknown): v is KeybindingPreset {
  return v === "normal" || v === "vim" || v === "emacs";
}

export interface KeyPress {
  /** KeyboardEvent.code, e.g. "KeyH", "BracketLeft". */
  code: string;
  /** Requires Ctrl (or Cmd on macOS). */
  ctrl?: boolean;
  /** Requires Alt (Option on macOS). */
  alt?: boolean;
  /** When set, Shift must match exactly; when omitted, Shift is ignored. */
  shift?: boolean;
}

/** A shortcut can be a local key-press object or a tinykeys binding string. */
export type KeyChord = KeyPress | string;

export interface NavBinding {
  /** Detail view: previous/next file. */
  prev: KeyChord[];
  next: KeyChord[];
  /** List view: page scroll (PageUp/PageDown-like). */
  pageUp: KeyChord[];
  pageDown: KeyChord[];
  /** List view: focus the search field. */
  focusSearch: KeyChord[];
}

export const NAV_BINDINGS: Record<KeybindingPreset, NavBinding> = {
  normal: {
    prev: [{ code: "BracketLeft" }],
    next: [{ code: "BracketRight" }],
    pageUp: [{ code: "PageUp" }],
    pageDown: [{ code: "PageDown" }],
    focusSearch: [{ code: "KeyF", ctrl: true }],
  },
  vim: {
    prev: [{ code: "KeyH" }],
    next: [{ code: "KeyL" }],
    // Vim's C-f / C-b scroll a full screen; treat them as PageDown / PageUp.
    pageUp: [{ code: "KeyB", ctrl: true }, { code: "PageUp" }],
    pageDown: [{ code: "KeyF", ctrl: true }, { code: "PageDown" }],
    focusSearch: [{ code: "Slash", shift: false }],
  },
  emacs: {
    prev: [{ code: "KeyB", ctrl: true }],
    next: [{ code: "KeyF", ctrl: true }],
    // Emacs scroll-down (C-v) / scroll-up (M-v).
    pageUp: [{ code: "KeyV", alt: true }, { code: "PageUp" }],
    pageDown: [{ code: "KeyV", ctrl: true }, { code: "PageDown" }],
    focusSearch: [{ code: "Slash", shift: false }],
  },
};

export interface GridBinding {
  /** Move the focused item up one row / down one row (by column count in the grid). */
  up: KeyChord[];
  down: KeyChord[];
  /** Move the focused item left / right by one. */
  left: KeyChord[];
  right: KeyChord[];
  /** Open the focused item (detail view). */
  open: KeyChord[];
}

// Per-preset focus navigation for the list/grid/table views. Open is always Enter.
// These are consulted only while the list is foreground (no detail/settings modal on top),
// so vim h/l and emacs C-b/C-f do not clash with the detail view's prev/next.
export const GRID_BINDINGS: Record<KeybindingPreset, GridBinding> = {
  normal: {
    up: [{ code: "ArrowUp" }],
    down: [{ code: "ArrowDown" }],
    left: [{ code: "ArrowLeft" }],
    right: [{ code: "ArrowRight" }],
    open: [{ code: "Enter" }],
  },
  vim: {
    up: [{ code: "KeyK" }],
    down: [{ code: "KeyJ" }],
    left: [{ code: "KeyH" }],
    right: [{ code: "KeyL" }],
    open: [{ code: "Enter" }],
  },
  emacs: {
    up: [{ code: "KeyP", ctrl: true }],
    down: [{ code: "KeyN", ctrl: true }],
    left: [{ code: "KeyB", ctrl: true }],
    right: [{ code: "KeyF", ctrl: true }],
    open: [{ code: "Enter" }],
  },
};

/**
 * Declarative "?" chord for the shortcuts overlay (preset-independent).
 * Single source of the physical-key fallback used by {@link isHelpKey};
 * actual matching goes through that helper so it works across layouts.
 */
export const HELP_KEY: KeyPress = { code: "Slash", shift: true };

/**
 * Whether the event is the shortcuts-overlay key ("?").
 *
 * Checks the produced character (`e.key === "?"`) first so it works regardless of
 * physical layout (AZERTY, JIS, …). AltGraph is allowed on that path since some
 * layouts type "?" via AltGr (browsers report it as Ctrl+Alt); real Ctrl/Meta/Alt
 * shortcuts are still rejected. The fallback matches {@link HELP_KEY} by `code`
 * for layouts/IMEs where `key` may not surface "?" and stays strict about
 * modifiers so it never fires alongside a real shortcut.
 */
export function isHelpKey(e: KeyboardEvent): boolean {
  if (e.key === "?") {
    // AltGr shows up as ctrlKey+altKey; only reject non-AltGraph modifier combos.
    if (e.getModifierState?.("AltGraph")) return true;
    return !e.ctrlKey && !e.metaKey && !e.altKey;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.code === HELP_KEY.code && e.shiftKey;
}

const matcherCache = new WeakMap<
  KeyChord[],
  { matches: (e: KeyboardEvent) => boolean }
>();

function isKeyPress(c: KeyChord): c is KeyPress {
  return typeof c !== "string";
}

function withShiftVariants(
  parts: string[],
  shift: KeyPress["shift"],
): string[][] {
  if (shift === true) return [[...parts, "Shift"]];
  if (shift === undefined) return [parts, [...parts, "Shift"]];
  return [parts];
}

function keyPressToTinykeys(c: KeyPress): string[] {
  const mods = withShiftVariants(c.alt ? ["Alt"] : [], c.shift);
  if (!c.ctrl) return mods.map((variant) => [...variant, c.code].join("+"));
  return ["Control", "Meta"].flatMap((mod) =>
    mods.map((variant) => [...variant, mod, c.code].join("+")),
  );
}

function chordToTinykeys(c: KeyChord): string[] {
  return typeof c === "string" ? [c] : keyPressToTinykeys(c);
}

function createMatcher(chords: KeyChord[]): {
  matches: (e: KeyboardEvent) => boolean;
} {
  let matched = false;
  const keybindings: Record<string, (e: KeyboardEvent) => void> = {};
  for (const chord of chords) {
    for (const input of chordToTinykeys(chord)) {
      keybindings[input] = () => {
        matched = true;
      };
    }
  }
  const handler = createKeybindingsHandler(keybindings);
  return {
    matches(e) {
      matched = false;
      handler(e);
      return matched;
    },
  };
}

/** Whether a keyboard event matches a chord. String sequences should be matched via matchAny. */
export function matchChord(e: KeyboardEvent, c: KeyChord): boolean {
  const inputs = chordToTinykeys(c);
  return inputs.some((input) => {
    const sequence = parseKeybinding(input);
    return sequence.length === 1 && matchKeyBindingPress(e, sequence[0]);
  });
}

export function matchAny(e: KeyboardEvent, chords: KeyChord[]): boolean {
  let matcher = matcherCache.get(chords);
  if (!matcher) {
    matcher = createMatcher(chords);
    matcherCache.set(chords, matcher);
  }
  return matcher.matches(e);
}

// Human-readable key labels for the shortcuts overlay / tooltips.
const CODE_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Space: "Space",
  Home: "Home",
  Escape: "Esc",
  Enter: "Enter",
};

function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Formats a single chord, e.g. "Ctrl+f", "[", "h". */
export function formatChord(c: KeyChord): string {
  if (!isKeyPress(c)) return c;
  const mods: string[] = [];
  if (c.ctrl) mods.push("Ctrl");
  if (c.alt) mods.push("Alt");
  if (c.shift) mods.push("Shift");
  return [...mods, codeLabel(c.code)].join("+");
}

/** Formats a list of chords joined by " / ", e.g. "Ctrl+f / PgDn". */
export function formatChords(chords: KeyChord[]): string {
  return chords.map(formatChord).join(" / ");
}
