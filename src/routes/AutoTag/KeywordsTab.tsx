// Keywords tab: the dictionary — each entry some terms to find in a name and
// the tags a file whose name holds any of them gets — and the pane beside it
// editing whichever is selected.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { KeywordEntry } from "@shared/autoTag";
import { MAX_TAG_NAME } from "@shared/tags";
import { MAX_ROWS, MONO, keywordMatches, newKeyword } from "./helpers";
import { KeywordEditor } from "./KeywordEditor";
import { MoreRows, SplitPane } from "./parts";
import type { AutoTagState } from "./useAutoTag";
import { useTagMigration } from "./useTagMigration";
import { useViewState } from "./viewState";

/** Entries past which the list gets a filter box. */
const FILTER_FROM = 8;

export function KeywordsTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const { config, update, names, existing } = state;
  const [selection, setSelection] = useViewState<string | null>(
    "keywords.selection",
    null,
  );
  const [filter, setFilter] = useViewState("keywords.filter", "");
  const [draft, setDraft] = useState("");
  const migrate = useTagMigration(state);

  // What is selected, falling back to the first entry when nothing is, or
  // when the selected one was deleted.
  const shown =
    config.keywords.find((entry) => entry.id === selection) ??
    config.keywords[0];

  const patchKeyword = (id: string, change: Partial<KeywordEntry>) =>
    update((c) => ({
      ...c,
      keywords: c.keywords.map((k) => (k.id === id ? { ...k, ...change } : k)),
    }));

  // Delete an entry; with `next`, that entry is selected and its row focused
  // in its stead (the keyboard's way of deleting, which carries on from there).
  const listRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const deleteKeyword = (id: string, next?: string) => {
    update((c) => ({
      ...c,
      keywords: c.keywords.filter((k) => k.id !== id),
    }));
    setSelection(next ?? null);
    if (next) focusNext.current = next;
  };
  // After the render that took the deleted row away: the row asked for, if
  // there is one, gets the focus the deleted one had.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>(
      "[data-keyword]",
    ) ?? []) {
      if (row.dataset.keyword === id) row.focus();
    }
  });

  // "Term, term, term": the first one also names the tag, to begin with.
  const addKeyword = () => {
    const entry = newKeyword(config.keywords, draft.split(/[,、]/), existing);
    if (!entry) return;
    update((c) => ({ ...c, keywords: [...c.keywords, entry] }));
    setSelection(entry.id);
    setDraft("");
    setFilter("");
  };

  // The filter only applies while its box is on screen: deleting entries can
  // take the box away, and a filter nobody can see or clear must not keep
  // hiding the list.
  const filterable = config.keywords.length > FILTER_FROM;
  const q = filterable ? filter.trim().toLowerCase() : "";
  const matching = q
    ? config.keywords.filter((entry) =>
        [...entry.terms, ...entry.tags].some((text) =>
          text.toLowerCase().includes(q),
        ),
      )
    : config.keywords;
  // The rows drawn — and the selected entry among them even when it sits past
  // the cut, so what the pane edits is always marked in the list.
  const keywords = matching.slice(0, MAX_ROWS);
  if (shown && matching.includes(shown) && !keywords.includes(shown)) {
    keywords.push(shown);
  }

  return (
    <SplitPane
      aside={
        <div ref={listRef} className="flex flex-col gap-0.5 p-3">
          <div className="flex items-baseline gap-2 px-1 pb-2 pt-0.5">
            <span className="text-xs font-semibold text-fg">
              {t("autoTag.keywords")}
            </span>
            <span className="text-xs tabular-nums text-muted">
              {config.keywords.length}
            </span>
            <span className="min-w-0 truncate text-xs text-muted">
              {t("autoTag.keywordsHint")}
            </span>
          </div>
          {filterable && (
            <input
              className="mb-1 h-7 rounded-md border border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
              value={filter}
              placeholder={t("autoTag.filterKeywords")}
              aria-label={t("autoTag.filterKeywords")}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {keywords.map((entry, at) => (
            <button
              key={entry.id}
              type="button"
              data-keyword={entry.id}
              onClick={() => setSelection(entry.id)}
              // Delete on the row deletes the entry and moves on to the one
              // that takes its place, so a run of them can go one key press
              // each. Only here: in a field the key edits text.
              onKeyDown={(e) => {
                if (e.key !== "Delete" || e.nativeEvent.isComposing) return;
                if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
                e.preventDefault();
                deleteKeyword(
                  entry.id,
                  (keywords[at + 1] ?? keywords[at - 1])?.id,
                );
              }}
              aria-current={shown?.id === entry.id}
              className={cn(
                "flex items-center gap-2.5 rounded-lg p-2 text-left",
                shown?.id === entry.id ? "bg-overlay" : "hover:bg-surface",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(MONO, "truncate text-[13px] text-bright-fg")}
                >
                  {entry.terms.join(", ") || t("autoTag.keyword.noTermsShort")}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {entry.tags.join(", ") || t("autoTag.keyword.noTagsShort")}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {t("autoTag.fileCount", {
                  count: keywordMatches(entry, names).length,
                })}
              </span>
            </button>
          ))}
          <MoreRows t={t} hidden={matching.length - keywords.length} />
          {q !== "" && matching.length === 0 && (
            <p className="px-2 pb-1 text-xs text-muted">
              {t("autoTag.noKeywordsMatch")}
            </p>
          )}
          {config.keywords.length === 0 && (
            <p className="px-2 pb-1 text-xs text-muted">
              {t("autoTag.noKeywords")}
            </p>
          )}
          <input
            className="mt-2 h-8 rounded-lg border border-dashed border-border-strong bg-transparent px-2.5 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
            value={draft}
            maxLength={MAX_TAG_NAME * 4}
            placeholder={t("autoTag.addKeywordInline")}
            aria-label={t("autoTag.addKeywordInline")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Not while an IME is composing: that Enter only confirms the text.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) addKeyword();
            }}
          />
        </div>
      }
    >
      {shown && (
        <KeywordEditor
          // Per entry: a term or tag being typed belongs to the one it was
          // typed for.
          key={shown.id}
          entry={shown}
          names={names}
          existing={existing}
          onChange={(change) => patchKeyword(shown.id, change)}
          onDelete={() => deleteKeyword(shown.id)}
          // The files the entry finds — by its terms, which the rename left
          // alone — are the ones its tag may be on.
          onTagRenamed={(from, to) =>
            void migrate(
              keywordMatches(shown, names).map((row) => row.index),
              from,
              to,
            )
          }
        />
      )}
    </SplitPane>
  );
}
