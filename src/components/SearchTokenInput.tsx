// The library search box. Free text stays editable text; an exact-tag directive
// (`tag:beach`, `tag:long`) becomes a chip, because it only means anything as a
// whole: backspacing through the middle of one turns an exact tag match into a
// substring search that also hits file names, with nothing on screen to say so.
// While one is being typed the box completes it from the tag catalog.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import {
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  isTagDirective,
  joinSearchTokens,
  parseTagSearchToken,
  splitSearchTokens,
  tagSearchKey,
  tagSearchToken,
} from "@shared/tags";
import { api } from "@/ipc/client";
import type { TagSummary } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { searchTokenLabel, tagHumanLabel } from "@/lib/tagLabel";
import {
  pendingDirective,
  splitQueryChips,
  tagSuggestions,
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
  if (value !== seen) {
    // React's sanctioned "adjust state when a prop changes" pattern, not a
    // mistake: setting state during render of the *same* component restarts
    // this render before anything is committed. An effect would paint the stale
    // draft first and then correct it, which is a visible flicker in a field
    // the user is typing into.
    setSeen(value);
    setState(splitQueryChips(value));
  }

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
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

  const pending = focused && picked === null ? pendingDirective(draft) : null;
  const status = useAppStatus();
  // Same key and fetcher as the tag management screen, so the two share one
  // cached catalog; `enabled` keeps it unfetched until a directive is actually
  // being typed. Filtering client-side beats a round trip per keystroke — the
  // catalog is capped at MAX_TAG_LIST and is invalidated by every tag mutation.
  const catalog = useQuery({
    queryKey: ["tags_list_all", status.data?.workspaceId ?? ""],
    queryFn: api.tagsListAll,
    enabled: (status.data?.ready ?? false) && pending !== null,
  });
  const suggestions = useMemo(
    () => (pending ? tagSuggestions(catalog.data?.tags ?? [], pending) : []),
    [catalog.data, pending],
  );
  const open = !dismissed && suggestions.length > 0;
  const activeIndex = Math.min(active, suggestions.length - 1);

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
    setActive(0);
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
    const directives = tokens.filter(isTagDirective);
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
      const key = tagSearchKey(chip);
      if (key !== null) taken.set(key, i);
    });
    const promoted: string[] = [];
    let repeated: number | null = null;
    for (const token of directives) {
      const key = tagSearchKey(token);
      if (key === null) continue;
      const at = taken.get(key);
      if (at !== undefined) {
        repeated = at;
        continue;
      }
      taken.set(key, chips.length + promoted.length);
      promoted.push(token);
    }
    const rest = tokens.filter((token) => !isTagDirective(token));
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
        const wanted = tagSearchKey(splitSearchTokens(token)[0] ?? "");
        const at = chips.findIndex((chip) => tagSearchKey(chip) === wanted);
        if (wanted !== null && at >= 0) highlight(at);
      }),
    [chips, highlight],
  );

  /** Swap the directive under the caret for the chosen tag and chip it. */
  const accept = (tag: TagSummary) => {
    const tokens = splitSearchTokens(draft);
    tokens[tokens.length - 1] = tagSearchToken(tag.name);
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
        const body = parseTagSearchToken(token) ?? "";
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
              <span className="text-muted">{TAG_SEARCH_PREFIX}:</span>
              {body}
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
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          aim(null);
        }}
        onKeyDown={(e) => {
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
            setActive(
              (activeIndex + step + suggestions.length) % suggestions.length,
            );
          } else if (open && e.key === "Tab" && !e.shiftKey) {
            // Tab completes, as it does in a shell. preventDefault keeps the
            // caret here so the next condition can be typed straight away;
            // Shift+Tab still means "leave", and blurring closes the list.
            e.preventDefault();
            accept(suggestions[activeIndex]);
          } else if (e.key === "Enter") {
            if (open) accept(suggestions[activeIndex]);
            // Leaving the field clears the highlight, so a repeat keeps focus:
            // Enter on a condition already on would otherwise look like the box
            // ate it — the one failure the user cannot see.
            else if (apply(draft, true) === null) e.currentTarget.blur();
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
        <ul
          id={listId}
          role="listbox"
          aria-label={t("filter.tagSuggestions")}
          // Keep the field focused: a blur here would close the list before the
          // click landed on an option.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {suggestions.map((tag, i) => (
            <li
              key={tag.qualified}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(tag)}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2 py-1 text-sm",
                i === activeIndex && "bg-fg/10",
              )}
            >
              <span className="truncate">
                <span className="text-muted">{TAG_SEARCH_PREFIX}:</span>
                {tag.name}
              </span>
              {tag.namespace && (
                <span className="truncate text-xs text-muted">
                  {tagHumanLabel(t, tag.namespace, tag.name)}
                </span>
              )}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                {tag.fileCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
