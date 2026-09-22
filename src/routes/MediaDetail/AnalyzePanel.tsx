// "Analyze this file": runs the active AI model on the open file and lists what
// it recognized — the best matches from the app's built-in discovery label set,
// independent of the user's vocabulary — so the user can pick what to keep.
// Picked entries can become manual tags (user-owned, searchable, editable) or
// be added to the vocabulary so every file gets them automatically. The
// automatic `ai:` tags are refreshed by the same call and stay what they are.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookPlus, Loader2, Plus, Sparkles } from "lucide-react";
import { AI_STATUS_KEY } from "@/hooks/useAiStatus";
import { invalidateAfterAnalysis } from "@/lib/queryCache";
import { Button } from "@/components/ui/button";
import { api } from "@/ipc/client";
import type { AiCandidate, TagInfo } from "@shared/ipc/schema";
import type { TFunc } from "@/i18n/I18nProvider";

interface Props {
  id: number;
  wsId: string;
  /** Current tags, to mark entries the file already carries as a manual tag. */
  tags: TagInfo[];
  /** Attach one manual tag (the detail view's existing add mutation). */
  onAdd: (name: string) => Promise<unknown>;
  t: TFunc;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Labels listed per analysis. */
const SHOW_MAX = 15;
/** How many of the top labels start pre-selected. */
const PRESELECT = 3;

export function AnalyzePanel({ id, wsId, tags, onAdd, t }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vocabAdded, setVocabAdded] = useState<Set<string>>(new Set());

  const analyze = useMutation({
    mutationFn: () => api.aiAnalyzeFile(id, wsId),
    onSuccess: (candidates) => {
      setSelected(new Set(candidates.slice(0, PRESELECT).map((c) => c.entry)));
      setVocabAdded(new Set());
      // The call stored an embedding and rewrote this file's ai: tags, so the
      // tags on screen, every neighbour list and the pending count are stale.
      invalidateAfterAnalysis(qc, wsId, id);
    },
  });

  const manualNames = useMemo(
    () =>
      new Set(
        tags
          .filter((tag) => tag.namespace === "" && tag.source === "manual")
          .map((tag) => tag.name.toLowerCase()),
      ),
    [tags],
  );

  const shown: AiCandidate[] = useMemo(
    () => (analyze.data ?? []).slice(0, SHOW_MAX),
    [analyze.data],
  );

  const addSelected = useMutation({
    mutationFn: async () => {
      for (const entry of selected) {
        if (!manualNames.has(entry.toLowerCase())) await onAdd(entry);
      }
    },
    onSuccess: () => setSelected(new Set()),
  });

  const inVocabulary = (c: AiCandidate) =>
    c.inVocabulary || vocabAdded.has(c.entry);
  // A candidate the file already carries as a manual tag is ticked and locked,
  // but it is still a word the vocabulary may be missing — so it counts here.
  const vocabAddable = shown.filter(
    (c) =>
      (selected.has(c.entry) || manualNames.has(c.entry.toLowerCase())) &&
      !inVocabulary(c),
  );
  const addToVocabulary = useMutation({
    mutationFn: () => api.aiVocabularyAdd(vocabAddable.map((c) => c.entry)),
    onSuccess: () => {
      setVocabAdded((prev) => {
        const next = new Set(prev);
        for (const c of vocabAddable) next.add(c.entry);
        return next;
      });
      void qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
    },
  });

  const toggle = (entry: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });

  const addable = [...selected].filter(
    (e) => !manualNames.has(e.toLowerCase()),
  );

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-muted">
          {t("media.analyze")}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={analyze.isPending}
          onClick={() => analyze.mutate()}
        >
          {analyze.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {analyze.data ? t("media.analyzeAgain") : t("media.analyzeRun")}
        </Button>
      </div>
      {(analyze.isError || addToVocabulary.isError) && (
        <p className="text-xs text-error">
          {errorText(analyze.error ?? addToVocabulary.error)}
        </p>
      )}
      {analyze.data && shown.length === 0 && (
        <p className="text-xs text-muted">{t("media.analyzeNothing")}</p>
      )}
      {shown.length > 0 && (
        <>
          <p className="text-xs text-muted">{t("media.analyzeHint")}</p>
          <ul className="flex flex-col gap-1">
            {shown.map((c) => {
              const already = manualNames.has(c.entry.toLowerCase());
              const checked = already || selected.has(c.entry);
              const pct = Math.round(c.score * 100);
              // Bar relative to the best label: with ~1.5k labels competing,
              // absolute probabilities are small even for a clear match.
              const rel = Math.round((c.score / (shown[0]?.score || 1)) * 100);
              return (
                <li key={c.entry}>
                  <label
                    className={
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-overlay " +
                      (already ? "text-muted" : "text-fg")
                    }
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--c-primary)]"
                      checked={checked}
                      disabled={already}
                      onChange={() => toggle(c.entry)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.entry}
                      {inVocabulary(c) && (
                        <span className="ml-1.5 text-[10px] text-muted">
                          {t("media.analyzeInVocabulary")}
                        </span>
                      )}
                    </span>
                    <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-overlay">
                      <span
                        className="absolute inset-y-0 left-0 bg-accent2"
                        style={{ width: `${Math.max(2, rel)}%` }}
                      />
                    </span>
                    <span className="w-9 text-right font-mono text-xs tabular-nums text-muted">
                      {pct}%
                    </span>
                    {already && (
                      <span className="text-xs text-muted">
                        {t("media.analyzeTagged")}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={vocabAddable.length === 0 || addToVocabulary.isPending}
              onClick={() => addToVocabulary.mutate()}
              title={t("ai.vocabulary")}
            >
              {addToVocabulary.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookPlus className="size-4" />
              )}
              {t("media.analyzeAddVocabulary", { count: vocabAddable.length })}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={addable.length === 0 || addSelected.isPending}
              onClick={() => addSelected.mutate()}
            >
              {addSelected.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t("media.analyzeAddTags", { count: addable.length })}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
