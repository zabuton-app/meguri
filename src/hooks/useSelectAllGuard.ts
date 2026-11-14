// Swallow Ctrl/Cmd+A outside form fields.
// styles.css makes selection opt-in, but Ctrl+A would still select every
// `select-text` region at once — the whole-window highlight this is meant to
// avoid. Inside an input/textarea/contenteditable the shortcut keeps its normal
// meaning, so "select all" stays a field affordance like in a native app.
import { useEffect } from "react";
import { isTyping } from "@/lib/keyTarget";

// Chromium triggers select-all off the produced character, not the physical key:
// on AZERTY the key labelled "A" is KeyQ, so a `code`-only test never fires there.
// Match `key` first — the same shape as isHelpKey() in src/settings/keybindings.ts.
/**
 * Exported so the list's "select all" binding and this guard agree on what
 * Ctrl/Cmd+A is. The guard only suppresses the browser default; whichever
 * surface gives the chord a meaning reads it from here.
 */
export function isSelectAllKey(e: KeyboardEvent): boolean {
  if (!e.ctrlKey && !e.metaKey) return false;
  // Ctrl+Shift+A / Ctrl+Alt+A are distinct chords that select-all never claims;
  // leaving them alone keeps future bindings on them working.
  if (e.shiftKey || e.altKey) return false;
  if (e.key === "a" || e.key === "A") return true;
  // Physical fallback only when `key` carries no character at all (IME / dead
  // keys). Unconditionally trusting `code` would claim AZERTY's Ctrl+Q, whose
  // "q" sits on KeyA — the same trap isHelpKey() sidesteps by testing the
  // character first and only falling back while no modifier is held.
  return e.key.length !== 1 && e.code === "KeyA";
}

export function useSelectAllGuard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSelectAllKey(e)) return;
      // A focused <select> has no text to select: the default would select
      // the whole page, which is what this guard is for.
      if (isTyping() && document.activeElement?.tagName !== "SELECT") return;
      e.preventDefault();
    };
    // Capture phase: a stopPropagation() anywhere in the tree (Radix and cmdk both
    // handle keydown) would otherwise let the default select-all through.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
