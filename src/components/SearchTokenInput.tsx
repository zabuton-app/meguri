// The library search box. Free text stays editable text; a directive
// (`tag:beach`, `tag:long`, `hash:3fa9c1d2`) becomes a chip, because it only
// means anything as a whole: backspacing through the middle of one turns an
// exact match into a substring search that also hits file names, with nothing
// on screen to say so.
// While one is being typed the box completes it from the tag catalog. An
// ordinary word at the end of the text is offered the tags it matches too
// (#542), below a first row that searches for the word itself, so Enter still
// does what it does without the list, and which row it takes is on screen.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search, X } from "lucide-react";
import {
  EXT_SEARCH_PREFIX,
  HASH_SEARCH_PREFIX,
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  isSearchDirective,
  joinSearchTokens,
  parseExtSearchToken,
  parseHashSearchToken,
  parseTagSearchToken,
  searchDirectiveKey,
  splitSearchTokens,
  tagSearchToken,
} from "@shared/tags";
import type { TagSummary } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n/I18nProvider";
import { useTagCompletions } from "@/hooks/useTagCompletions";
import { TagSuggestionLabel } from "@/components/TagSuggestionLabel";
import {
  generatedTagChipLabel,
  searchTokenLabel,
  tagNamespaceLabel,
} from "@/lib/tagLabel";
import {
  namespaceSuggestions,
  pendingDirective,
  plainWordAtCaret,
  splitQueryChips,
} from "@/lib/searchTokens";
import { onHighlightSearchToken } from "@/lib/ui-events";

interface Props {
  id?: string;
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
  title?: string;
}

export function SearchTokenInput({
  id,
  value,
  onChange,
  placeholder,
  title,
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Which part of the query is a chip and which is still text is the field's own
  // state, not a re-read of `value`: a draft of "tag:bea" parses as a directive
  // but must stay editable text until the user closes it. `seen` tells an echo of
  // our own change apart from one that came from elsewhere — a tag click,
  // "Clear all", a smart collection.
  const [{ chips, text: draft }, setState] = useState(() =>
    splitQueryChips(value),
  );
  const [seen, setSeen] = useState(value);
  // Whether the caret is at the end of the text: completion runs only there,
  // since a pick replaces the last token and not one being edited earlier.
  // Text set from elsewhere leaves the caret at its end.
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  if (value !== seen) {
    // React's sanctioned "adjust state when a prop changes" pattern, not a
    // mistake: setting state during render of the *same* component restarts
    // this render before anything is committed. An effect would paint the stale
    // draft first and then correct it, which is a visible flicker in a field
    // the user is typing into.
    setSeen(value);
    setState(splitQueryChips(value));
    setCaretAtEnd(true);
  }

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // The highlighted option, with the list it was highlighted in. A list that
  // closes drops it, and one that opens or changes starts from its first row
  // again (the word's own search, over a word), so no highlight is ever left
  // over from another list.
  const [active, setActiveFor] = useState<{
    list: string;
    index: number;
  } | null>(null);
  // Index of the chip the arrow keys have walked back onto, or null while the
  // caret is in the text. Focus stays in the input throughout: the chips are a
  // rendering of the query string, not widgets of their own.
  //
  // `armed` says the user aimed at this chip themselves, which is what makes the
  // next Backspace a confirmation rather than a surprise: the box also puts the
  // highlight on a chip on its own, to answer a condition typed twice, and that
  // one must not double as the first press of a delete.
  const [selected, setSelected] = useState<{
    at: number;
    armed: boolean;
  } | null>(null);
  const picked =
    selected !== null && selected.at < chips.length ? selected.at : null;
  // Stable so the highlight subscription below is not torn down and rebuilt on
  // every render; it only ever calls setSelected.
  const aim = useCallback(
    (at: number | null, armed = true) =>
      setSelected(at === null ? null : { at, armed }),
    [],
  );

  // Completion runs only with the caret at the end of the text (caretAtEnd),
  // and not while an input method composes: the text is not final yet, and
  // its own candidate window opens where the list would.
  const [composing, setComposing] = useState(false);
  const completing = focused && picked === null && caretAtEnd && !composing;
  const directiveValue = completing
    ? (pendingDirective(draft)?.value ?? null)
    : null;
  const word =
    completing && directiveValue === null ? plainWordAtCaret(draft) : null;
  // One object per value, so the completions are not filtered again on every
  // render. A word matches tag names only: the namespaces it would also hit
  // (`au` in `audio_genre`) are not what the list shows.
  const pending = useMemo(
    () =>
      directiveValue !== null
        ? { value: directiveValue }
        : word !== null
          ? { value: word, namesOnly: true }
          : null,
    [directiveValue, word],
  );
  const { suggestions, held } = useTagCompletions(pending);
  // A word that begins a generated namespace's name or label (`tempo`,
  // `テンポ`) is offered the namespace's directive (`tag:audio_tempo:`), the
  // first of two steps: once it is picked, its values are offered.
  const namespaces = useMemo(
    () =>
      word === null
        ? []
        : namespaceSuggestions(word, (ns) => tagNamespaceLabel(t, ns)),
    [word, t],
  );
  const open = !dismissed && (suggestions.length > 0 || namespaces.length > 0);
  // Over a word, row 0 searches for the word; namespaces and tags follow.
  const searchRow = word !== null;
  const offset = searchRow ? 1 : 0;
  const tagStart = offset + namespaces.length;
  const count = tagStart + suggestions.length;
  // Which list is open: its kind, what it completes and what it holds, so a
  // catalog fetched again in another order is another list.
  const list =
    open && pending
      ? `${offset}:${pending.value}:${[
          ...namespaces,
          ...suggestions.map((s) => s.qualified),
        ].join("\n")}`
      : null;
  if (active !== null && active.list !== list) setActiveFor(null);
  const activeIndex =
    active !== null && active.list === list
      ? Math.min(active.index, count - 1)
      : 0;
  const setActive = (index: number) => {
    if (list !== null) setActiveFor({ list, index });
  };

  const commit = (nextChips: string[], nextDraft: string) => {
    // Chips arrive unquoted (splitSearchTokens strips them), so re-quote them
    // here; the draft is passed through untouched to keep the caret where it is.
    // trimEnd, not trim of each part: the draft keeps the space the user typed
    // after a word, but the query it produces never carries a trailing one.
    const q = [joinSearchTokens(nextChips), nextDraft]
      .filter((part) => part.trim() !== "")
      .join(" ")
      .trimEnd();
    setState({ chips: nextChips, text: nextDraft });
    setSeen(q);
    onChange(q);
    setActiveFor(null);
    setDismissed(false);
    aim(null);
  };

  /** Drop the highlighted chip and leave the highlight on whatever slides into its place. */
  const removeSelected = (index: number) => {
    const next = chips.filter((_, j) => j !== index);
    commit(next, draft);
    aim(next.length ? Math.min(index, next.length - 1) : null);
  };

  /**
   * A token turns into a chip only once it is closed — by a space or by Enter
   * (`force`) — so `tag:lo…` is not pulled out of the field mid-word.
   *
   * Returns the chip a repeated condition was folded into, or null when nothing
   * was a repeat; Enter needs to know, because leaving the field would clear the
   * very highlight that says where what was typed went.
   */
  const apply = (raw: string, force = false): number | null => {
    const closed = force || (/\s$/.test(raw) && !hasOpenQuote(raw));
    const tokens = splitSearchTokens(raw);
    const typing = closed ? undefined : tokens.pop();
    const directives = tokens.filter(isSearchDirective);
    if (directives.length === 0) {
      commit(chips, raw);
      return null;
    }
    // A condition already in the box is not repeated — through the same key the
    // click path (addSearchTokens) compares on, so typing `tag:4k` and clicking
    // the tag land on the same query instead of one of them producing two chips.
    // The index each key sits at is kept so a repeat can point at the chip that
    // already carries it, the way a redundant click does.
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
    // Give back the space the user just typed, or the next word runs into the
    // last one. Only that space — re-joining must not invent one after a word
    // the caret is still sitting in (a pasted "tag:4k s").
    if (closed && !force && next) next += " ";
    commit([...chips, ...promoted], next);
    // After commit, which clears the highlight: a condition that quietly went
    // nowhere would otherwise read as the box swallowing what was typed. Not
    // armed — the user aimed at the text, not at the chip.
    if (repeated !== null) aim(repeated, false);
    return repeated;
  };

  /** Put the highlight on a chip and leave the field ready to act on it. */
  const highlight = useCallback(
    (index: number) => {
      aim(index);
      inputRef.current?.focus();
    },
    [aim],
  );

  // Clicking a tag that is already a condition changes nothing, so Home asks the
  // box to point at the chip it landed on. Matching is on the resolved value, not
  // the raw token: the two differ in quoting.
  useEffect(
    () =>
      onHighlightSearchToken((token) => {
        // Through the tokenizer first: the sender quotes a value with spaces,
        // the chips hold it unquoted.
        const wanted = searchDirectiveKey(splitSearchTokens(token)[0] ?? "");
        const at = chips.findIndex(
          (chip) => searchDirectiveKey(chip) === wanted,
        );
        if (wanted !== null && at >= 0) highlight(at);
      }),
    [chips, highlight],
  );

  /** Note whether the caret is at the end of the field's text. */
  const trackCaret = (field: HTMLInputElement) =>
    setCaretAtEnd(
      field.selectionStart === field.value.length &&
        field.selectionEnd === field.value.length,
    );

  // The row Enter takes is always on screen: one moved to below the list's
  // height (the word's own row makes eleven) is scrolled into view, within
  // the list alone (scrollIntoView would scroll the page around it too).
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = viewport.current;
    const row = open
      ? document.getElementById(`${listId}-${activeIndex}`)
      : null;
    if (!box || !row) return;
    const shown = box.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < shown.top) box.scrollTop -= shown.top - at.top;
    else if (at.bottom > shown.bottom)
      box.scrollTop += at.bottom - shown.bottom;
  }, [open, activeIndex, listId]);

  /** What Enter does without a list: close the text, keeping focus on a repeat. */
  const searchText = () => {
    // Leaving the field clears the highlight, so a repeat keeps focus: Enter
    // on a condition already on would otherwise look like the box ate it —
    // the one failure the user cannot see.
    if (apply(draft, true) === null) inputRef.current?.blur();
  };

  /** Take the option at `index`: the word's own search, a namespace, or a tag. */
  const take = (index: number) => {
    if (index < offset) searchText();
    else if (index < tagStart) startNamespace(namespaces[index - offset]);
    else accept(suggestions[index - tagStart]);
  };

  /**
   * Swap the word for the start of a directive on `ns`, left open so that
   * its values are offered next.
   */
  const startNamespace = (ns: string) => {
    const tokens = splitSearchTokens(draft);
    tokens[tokens.length - 1] = `${TAG_SEARCH_PREFIX}:${ns}:`;
    apply(joinSearchTokens(tokens));
    inputRef.current?.focus();
  };

  /** Swap the directive under the caret for the chosen tag and chip it. */
  const accept = (tag: TagSummary) => {
    const tokens = splitSearchTokens(draft);
    tokens[tokens.length - 1] = tagSearchToken(tag.name, tag.namespace);
    apply(`${joinSearchTokens(tokens)} `);
    inputRef.current?.focus();
  };

  return (
    <div
      onMouseDown={(e) => {
        // Clicking the padding around the chips should land in the text field,
        // but a click on a chip's ✗ must still reach the button.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        inputRef.current?.focus();
      }}
      title={title}
      className={cn(
        "relative flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1 rounded-md border border-border-strong bg-bg px-2 py-1 text-sm text-fg transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring",
      )}
    >
      {/* A flex child rather than an overlay the padding has to leave room for:
          reserving a fixed strip left a visible gap in front of the first chip,
          and the two could drift apart. pointer-events-none so a click on the
          icon still lands on the box and focuses the field. */}
      <Search className="pointer-events-none size-3.5 shrink-0 text-muted" />
      {chips.map((token, i) => {
        const hash = parseHashSearchToken(token);
        const ext = parseExtSearchToken(token);
        const prefix =
          hash !== null
            ? HASH_SEARCH_PREFIX
            : ext !== null
              ? EXT_SEARCH_PREFIX
              : TAG_SEARCH_PREFIX;
        const body = hash ?? ext ?? parseTagSearchToken(token) ?? "";
        // A generated tag reads as its category and value (`Tempo: Fast`).
        const human =
          hash === null && ext === null
            ? generatedTagChipLabel(t, token)
            : null;
        return (
          <span
            key={`${token}-${i}`}
            data-slot="search-chip"
            data-selected={i === picked ? "true" : undefined}
            // Mouse parity with the arrow keys: clicking a condition aims at it
            // rather than doing nothing.
            onClick={() => highlight(i)}
            title={searchTokenLabel(t, token) ?? undefined}
            className={cn(
              "flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded py-0 pl-1.5 pr-0.5 text-xs",
              i === picked ? "bg-primary/25 ring-1 ring-ring" : "bg-fg/10",
            )}
          >
            <span className="truncate">
              {human ?? (
                <>
                  <span className="text-muted">{prefix}:</span>
                  {body}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={(e) => {
                // Otherwise the chip's own handler would highlight what is
                // already gone.
                e.stopPropagation();
                commit(
                  chips.filter((_, j) => j !== i),
                  draft,
                );
              }}
              aria-label={t("home.removeChip")}
              className="rounded-full p-0.5 transition hover:bg-fg/15"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        id={id}
        ref={inputRef}
        value={draft}
        onChange={(e) => apply(e.target.value)}
        onSelect={(e) => trackCaret(e.currentTarget)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onFocus={(e) => {
          setFocused(true);
          trackCaret(e.currentTarget);
        }}
        onBlur={() => {
          setFocused(false);
          aim(null);
        }}
        onKeyDown={(e) => {
          // Keys that pick a conversion in an input method are the IME's.
          // Chromium marks them isComposing, the one that confirms it too
          // (keyCode 229 is not checked: some Linux input methods send every
          // key as 229). An Esc that cancels a conversion stays in the field.
          if (e.nativeEvent.isComposing) {
            if (e.key === "Escape") e.stopPropagation();
            return;
          }
          // The caret is at the very start with nothing selected, so Left and
          // Backspace have nothing left to act on in the text — that is the
          // moment they start walking back over the chips instead.
          const atStart =
            e.currentTarget.selectionStart === 0 &&
            e.currentTarget.selectionEnd === 0;
          const highlight = (index: number | null) => {
            e.preventDefault();
            aim(index);
          };

          if (e.key === "Escape") {
            e.stopPropagation();
            // Each Esc undoes one layer: the highlight, then the suggestions,
            // then focus — the field keeps what the user was typing throughout.
            if (picked !== null) aim(null);
            else if (open) setDismissed(true);
            else e.currentTarget.blur();
          } else if (e.key === "ArrowLeft") {
            if (picked !== null) highlight(Math.max(0, picked - 1));
            else if (atStart && chips.length) highlight(chips.length - 1);
          } else if (e.key === "ArrowRight") {
            // Off the right edge is back into the text, where the caret was.
            if (picked !== null)
              highlight(picked === chips.length - 1 ? null : picked + 1);
          } else if (
            picked !== null &&
            (e.key === "Backspace" || e.key === "Delete")
          ) {
            e.preventDefault();
            // A highlight the box placed itself has not been confirmed by
            // anyone: this press arms it, exactly as the first Backspace does
            // on a chip the arrow keys walked onto.
            if (selected?.armed) removeSelected(picked);
            else aim(picked);
          } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((activeIndex + step + count) % count);
          } else if (open && !searchRow && e.key === "Tab" && !e.shiftKey) {
            // After `tag:`, Tab completes, as it does in a shell.
            // preventDefault keeps the caret here so the next condition can be
            // typed straight away; Shift+Tab still means "leave", and blurring
            // closes the list. Over a word Tab leaves, as in any field.
            e.preventDefault();
            accept(suggestions[activeIndex]);
          } else if (e.key === "Enter") {
            if (open) take(activeIndex);
            else searchText();
          } else if (e.key === "Backspace" && atStart && chips.length > 0) {
            // Highlight rather than delete: the chip is about to disappear with
            // no undo, and one more Backspace confirms it.
            highlight(chips.length - 1);
          } else if (picked !== null && e.key.length === 1) {
            // Typing means the user is done with the chips.
            aim(null);
          }
        }}
        placeholder={chips.length ? undefined : placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        className="h-6 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted"
      />
      {open && (
        // Capped by max-height, not sized: the scroll area is a flex column so
        // its viewport can shrink as a flex item (see ShortcutsOverlay).
        <div
          // Keep the field focused: a blur here would close the list before the
          // click landed on an option (or while its scrollbar is dragged).
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-20 mt-1 flex max-h-72 flex-col rounded-md border border-border bg-surface shadow-lg"
        >
          {/* type="auto": an always-on scrollbar track would sit over the
              options' edges and take their clicks even when nothing overflows. */}
          <ScrollArea
            type="auto"
            className="page-scroll flex min-h-0 flex-1 flex-col"
            viewportClassName="min-h-0 flex-1 py-1"
            viewportRef={viewport}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={t("filter.tagSuggestions")}
            >
              {searchRow && (
                <li
                  id={`${listId}-0`}
                  role="option"
                  aria-selected={activeIndex === 0}
                  onMouseMove={() => {
                    if (activeIndex !== 0) setActive(0);
                  }}
                  onClick={searchText}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2 py-1 text-sm",
                    activeIndex === 0 && "bg-fg/10",
                  )}
                >
                  <Search className="size-3.5 shrink-0 text-muted" />
                  <span className="truncate">
                    {/* The whole text, which is what it searches for. */}
                    {t("command.searchFor", { q: draft.trim() })}
                  </span>
                </li>
              )}
              {namespaces.map((ns, i) => (
                <li
                  key={ns}
                  id={`${listId}-${i + offset}`}
                  role="option"
                  aria-selected={i + offset === activeIndex}
                  onMouseMove={() => {
                    if (activeIndex !== i + offset) setActive(i + offset);
                  }}
                  onClick={() => startNamespace(ns)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2 py-1 text-sm",
                    i + offset === activeIndex && "bg-fg/10",
                  )}
                >
                  <span className="truncate">
                    <span className="text-muted">{TAG_SEARCH_PREFIX}:</span>
                    {ns}:
                  </span>
                  <span className="truncate text-xs text-muted">
                    {tagNamespaceLabel(t, ns)}
                  </span>
                </li>
              ))}
              {suggestions.map((tag, i) => (
                <li
                  key={tag.qualified}
                  id={`${listId}-${i + tagStart}`}
                  role="option"
                  aria-selected={i + tagStart === activeIndex}
                  // Moved, not entered: a list opening under a still pointer
                  // must not take the highlight from its first row.
                  onMouseMove={() => {
                    if (activeIndex !== i + tagStart) setActive(i + tagStart);
                  }}
                  onClick={() => accept(tag)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2 py-1 text-sm",
                    i + tagStart === activeIndex && "bg-fg/10",
                    // Offered, but with a word of warning: nothing here carries it.
                    !held(tag) && "text-muted",
                  )}
                >
                  <TagSuggestionLabel t={t} tag={tag} held={held(tag)} />
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
