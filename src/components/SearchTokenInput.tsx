// The library search box. Free text stays editable text; an exact-tag directive
// (`tag:beach`, `meta:long`) becomes a chip, because it only means anything as a
// whole: backspacing through the middle of one turns an exact tag match into a
// substring search that also hits file names, with nothing on screen to say so.
// While one is being typed the box completes it from the tag catalog.
import { useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import {
  META_SEARCH_PREFIX,
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  isTagDirective,
  joinSearchTokens,
  parseMetaSearchToken,
  parseTagSearchToken,
  splitSearchTokens,
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
    setSeen(value);
    setState(splitQueryChips(value));
  }

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  // Index of the chip the arrow keys have walked back onto, or null while the
  // caret is in the text. Focus stays in the input throughout: the chips are a
  // rendering of the query string, not widgets of their own.
  const [selected, setSelected] = useState<number | null>(null);
  const picked = selected !== null && selected < chips.length ? selected : null;

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
    setSelected(null);
  };

  /** Drop the highlighted chip and leave the highlight on whatever slides into its place. */
  const removeSelected = (index: number) => {
    const next = chips.filter((_, j) => j !== index);
    commit(next, draft);
    setSelected(next.length ? Math.min(index, next.length - 1) : null);
  };

  /**
   * A token turns into a chip only once it is closed — by a space or by Enter
   * (`force`) — so `meta:lo…` is not pulled out of the field mid-word.
   */
  const apply = (raw: string, force = false) => {
    const closed = force || (/\s$/.test(raw) && !hasOpenQuote(raw));
    const tokens = splitSearchTokens(raw);
    const typing = closed ? undefined : tokens.pop();
    const promoted = tokens.filter(isTagDirective);
    if (promoted.length === 0) {
      commit(chips, raw);
      return;
    }
    const rest = tokens.filter((token) => !isTagDirective(token));
    if (typing !== undefined) rest.push(typing);
    let next = joinSearchTokens(rest);
    // Give back the space the user just typed, or the next word runs into the
    // last one. Only that space — re-joining must not invent one after a word
    // the caret is still sitting in (a pasted "meta:4k s").
    if (closed && !force && next) next += " ";
    commit([...chips, ...promoted], next);
  };

  /** Swap the directive under the caret for the chosen tag and chip it. */
  const accept = (tag: TagSummary) => {
    const tokens = splitSearchTokens(draft);
    tokens[tokens.length - 1] = tagSearchToken(tag.namespace, tag.name);
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
        const meta = parseMetaSearchToken(token);
        const prefix = meta === null ? TAG_SEARCH_PREFIX : META_SEARCH_PREFIX;
        const body = meta ?? parseTagSearchToken(token) ?? "";
        return (
          <span
            key={`${token}-${i}`}
            data-slot="search-chip"
            data-selected={i === picked ? "true" : undefined}
            title={searchTokenLabel(t, token) ?? undefined}
            className={cn(
              "flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded py-0 pl-1.5 pr-0.5 text-xs",
              i === picked ? "bg-primary/25 ring-1 ring-ring" : "bg-fg/10",
            )}
          >
            <span className="truncate">
              <span className="text-muted">{prefix}:</span>
              {body}
            </span>
            <button
              type="button"
              onClick={() =>
                commit(
                  chips.filter((_, j) => j !== i),
                  draft,
                )
              }
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
          setSelected(null);
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
            setSelected(index);
          };

          if (e.key === "Escape") {
            e.stopPropagation();
            // Each Esc undoes one layer: the highlight, then the suggestions,
            // then focus — the field keeps what the user was typing throughout.
            if (picked !== null) setSelected(null);
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
            removeSelected(picked);
          } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive(
              (activeIndex + step + suggestions.length) % suggestions.length,
            );
          } else if (e.key === "Enter") {
            if (open) accept(suggestions[activeIndex]);
            else {
              apply(draft, true);
              e.currentTarget.blur();
            }
          } else if (e.key === "Backspace" && atStart && chips.length > 0) {
            // Highlight rather than delete: the chip is about to disappear with
            // no undo, and one more Backspace confirms it.
            highlight(chips.length - 1);
          } else if (picked !== null && e.key.length === 1) {
            // Typing means the user is done with the chips.
            setSelected(null);
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
                <span className="text-muted">
                  {tag.namespace ? META_SEARCH_PREFIX : TAG_SEARCH_PREFIX}:
                </span>
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
