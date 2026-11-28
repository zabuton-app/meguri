// The library search as the command menu's field edits it (#578): the
// directives as chips, the rest as text. A directive only means anything
// whole, so it is added and removed as one unit: backspacing through the
// middle of one would turn an exact tag match into a substring search with
// nothing on screen to say so. A token becomes a chip once the user closes it
// with a space, never mid-word.
//
// Focus never leaves the field: the chips are a rendering of the query, not
// widgets of their own. Once the caret runs out of text to its left, Left and
// Backspace walk back over the chips instead, highlighting one at a time.
import { useState } from "react";
import {
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  isSearchDirective,
  joinSearchTokens,
  searchDirectiveKey,
  splitSearchTokens,
  tagSearchToken,
} from "@shared/tags";
import type { TagSummary } from "@/ipc/types";
import { joinQueryChips, splitQueryChips } from "@/lib/searchTokens";

/** `initial` is the search to start from, as `reset` gives it later. */
export function useSearchDraft(initial: string) {
  const [{ chips, text }, setState] = useState(() => splitQueryChips(initial));
  // The search it started from, in the same shape as `query`: a draft that
  // still matches it has not been edited, only shown again.
  const [baseline, setBaseline] = useState(() => {
    const start = splitQueryChips(initial);
    return joinQueryChips(start.chips, start.text);
  });
  // The chip the arrow keys have walked onto, or null while the caret is in
  // the text. `armed` says the user aimed at it themselves, which makes the
  // next Backspace a confirmation rather than a surprise: the draft also
  // points at a chip on its own, to answer a condition typed twice, and that
  // must not double as the first press of a delete.
  const [selected, setSelected] = useState<{
    at: number;
    armed: boolean;
  } | null>(null);
  const picked =
    selected !== null && selected.at < chips.length ? selected.at : null;
  const aim = (at: number | null, armed = true) =>
    setSelected(at === null ? null : { at, armed });

  const set = (nextChips: string[], nextText: string) => {
    setState({ chips: nextChips, text: nextText });
    setSelected(null);
  };

  /**
   * Take what the field holds now: a directive closed by a space becomes a
   * chip, unless the draft already carries it (compared as the click path's
   * addSearchTokens compares), in which case the chip that does is pointed at.
   */
  const apply = (raw: string) => {
    const closed = /\s$/.test(raw) && !hasOpenQuote(raw);
    const tokens = splitSearchTokens(raw);
    const typing = closed ? undefined : tokens.pop();
    const directives = tokens.filter(isSearchDirective);
    if (directives.length === 0) {
      set(chips, raw);
      return;
    }
    const taken = new Map<string, number>();
    chips.forEach((chip, i) => {
      const key = searchDirectiveKey(chip);
      if (key !== null) taken.set(key, i);
    });
    const promoted: string[] = [];
    let repeated: number | null = null;
    for (const token of directives) {
      const key = searchDirectiveKey(token);
      if (key === null) continue;
      const at = taken.get(key);
      if (at !== undefined) {
        repeated = at;
        continue;
      }
      taken.set(key, chips.length + promoted.length);
      promoted.push(token);
    }
    const rest = tokens.filter((token) => !isSearchDirective(token));
    if (typing !== undefined) rest.push(typing);
    let next = joinSearchTokens(rest);
    // Give back the space just typed, or the next word runs into the last.
    if (closed && next) next += " ";
    set([...chips, ...promoted], next);
    // Not armed: the user aimed at the text, not at the chip.
    if (repeated !== null) aim(repeated, false);
  };

  const removeChip = (index: number, keepHighlight = false) => {
    const next = chips.filter((_, j) => j !== index);
    set(next, text);
    // From the keys, the highlight stays on whatever slides into its place.
    if (keepHighlight && next.length) aim(Math.min(index, next.length - 1));
  };

  /** Swap the word or directive at the end of the text for `token`'s chip. */
  const acceptToken = (token: string) => {
    const tokens = splitSearchTokens(text);
    tokens[tokens.length - 1] = token;
    apply(`${joinSearchTokens(tokens)} `);
  };

  /** Swap the word or directive at the end of the text for a tag's chip. */
  const accept = (tag: TagSummary) =>
    acceptToken(tagSearchToken(tag.name, tag.namespace));

  /** Swap the word at the end of the text for `token`, left open after it. */
  const startToken = (token: string) => {
    const tokens = splitSearchTokens(text);
    tokens[tokens.length - 1] = token;
    apply(joinSearchTokens(tokens));
  };

  /** Swap the word for a directive on `ns`, left open for its values. */
  const startNamespace = (ns: string) =>
    startToken(`${TAG_SEARCH_PREFIX}:${ns}:`);

  /**
   * The chip keys, for the field's keydown. Returns true when the key was
   * taken (and its default prevented), so the menu's list leaves it alone.
   */
  const onKey = (e: React.KeyboardEvent, field: HTMLInputElement): boolean => {
    // Left and Backspace have nothing left to act on in the text.
    const atStart = field.selectionStart === 0 && field.selectionEnd === 0;
    const take = (at: number | null) => {
      e.preventDefault();
      aim(at);
      return true;
    };
    if (e.key === "ArrowLeft") {
      if (picked !== null) return take(Math.max(0, picked - 1));
      if (atStart && chips.length) return take(chips.length - 1);
    } else if (e.key === "ArrowRight" && picked !== null) {
      // Off the right edge is back into the text.
      return take(picked === chips.length - 1 ? null : picked + 1);
    } else if (
      picked !== null &&
      (e.key === "Backspace" || e.key === "Delete")
    ) {
      e.preventDefault();
      if (selected?.armed) removeChip(picked, true);
      else aim(picked);
      return true;
    } else if (e.key === "Backspace" && atStart && chips.length) {
      // Highlight rather than delete: a chip goes with no undo, and one more
      // Backspace confirms it.
      return take(chips.length - 1);
    } else if (picked !== null && e.key.length === 1) {
      // Typing means the user is done with the chips.
      aim(null);
    }
    return false;
  };

  const query = joinQueryChips(chips, text);
  return {
    chips,
    text,
    picked,
    query,
    /** Whether the draft differs from the search it started from. */
    edited: query !== baseline,
    /** Start again from `q`. */
    reset: (q: string) => {
      const next = splitQueryChips(q);
      set(next.chips, next.text);
      setBaseline(joinQueryChips(next.chips, next.text));
    },
    /** Empty the text, keeping the chips. */
    clearText: () => set(chips, ""),
    apply,
    aim,
    removeChip,
    accept,
    acceptToken,
    startToken,
    startNamespace,
    onKey,
  };
}

export type SearchDraft = ReturnType<typeof useSearchDraft>;
