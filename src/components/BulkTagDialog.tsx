// Bulk tag editor for the current selection.
//
// The screen's job is to make a mixed selection editable without flattening it
// by accident. A tag only some of the selection carries is drawn differently
// from one they all carry, and both directions are one click: raise it to every
// file, or take it off every file. Nothing is written until Apply, so the
// staged state is always visible before it lands.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Undo2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { invalidateTagCatalog } from "@/lib/queryCache";
import { tallySelectionTags } from "@/lib/bulkTags";
import { bulkTargets } from "@/lib/bulkEdit";
import { useTagSuggestions } from "@/hooks/useTagSuggestions";
import { cn } from "@/lib/utils";
import type { FileRow } from "@/ipc/types";
import {
  MAX_BULK_FILES,
  MAX_BULK_TAG_NAMES,
  MAX_TAG_NAME,
  RESERVED_TAG_ERROR,
  reservedTagPrefix,
} from "@shared/tags";

// Mounted only while it is open (see SelectionLayer), so the staged edit starts
// empty every time: it belongs to one pass over one selection, and carrying it
// into the next opening would apply names staged against a different set.
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected rows, as the selection holds them. */
  rows: FileRow[];
  /** The edit was written: the caller re-reads the rows it holds. */
  onApplied?: () => void;
}

export function BulkTagDialog({ open, onOpenChange, rows, onApplied }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  // Names staged for this edit. Both are plain arrays so the order the user
  // added them in is the order they read back.
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);

  const total = rows.length;
  const tally = useMemo(() => tallySelectionTags(rows), [rows]);
  // Completion comes from one database — the first selected row's. A selection
  // can span workspaces, and tags_list is per-database by design; picking one
  // gives real names from a real catalog instead of a merged list that would
  // suggest names some of the targets have never seen.
  const suggestWorkspaceId = rows[0]?.workspaceId;

  // A name already in the tally has a chip of its own down the list, which
  // switches to "on every file" once it is staged. Repeating it up here would
  // show one tag twice, so only genuinely new names appear as staged chips.
  const stagedNew = useMemo(() => {
    const known = new Set(tally.map((entry) => entry.name));
    return adding.filter((name) => !known.has(name));
  }, [adding, tally]);

  const suggestions = useTagSuggestions(suggestWorkspaceId, input);

  const tooLong = input.trim().length > MAX_TAG_NAME;
  // One budget for the call, matching the IPC schema: additions and removals
  // are both names the edit has to carry.
  const atNameLimit = adding.length + removing.length >= MAX_BULK_TAG_NAMES;
  // The selection can outgrow what one transaction is allowed to write. Refuse
  // here, where the number can be explained, rather than letting main reject
  // the payload and surfacing a raw validation message.
  const tooManyFiles = total > MAX_BULK_FILES;

  /**
   * Stage a name for addition. The length is checked against the name being
   * staged, not against whatever sits in the field: a suggestion or an existing
   * tag is a known-good name, and judging it by an over-long draft in the input
   * would silently ignore the click.
   *
   * `clearInput` belongs to the two entry points that consume what was typed —
   * pressing Enter and picking a suggestion, which is derived from the input.
   * Raising an existing tag to the whole selection is not, so it leaves a draft
   * in the field alone.
   */
  const stageAdd = (name: string, clearInput = false) => {
    const value = name.trim();
    if (!value || value.length > MAX_TAG_NAME) return;
    if (!adding.includes(value) && atNameLimit) return;
    setAdding((prev) => (prev.includes(value) ? prev : [...prev, value]));
    // Adding a name back cancels a pending removal of it rather than leaving
    // the two to fight; main applies removals first, so both would end as "on"
    // anyway, and showing that as two live chips would be a lie.
    setRemoving((prev) => prev.filter((n) => n !== value));
    if (clearInput) setInput("");
  };

  const toggleRemove = (name: string) => {
    // Taking a staged removal back is always allowed; only adding one more
    // counts against the budget.
    if (!removing.includes(name) && atNameLimit) return;
    setRemoving((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
    setAdding((prev) => prev.filter((n) => n !== name));
  };

  const apply = useMutation({
    mutationFn: () => api.filesBulkTag(bulkTargets(rows), adding, removing),
    onSuccess: (result) => {
      // The refetch that follows flows back into the selection for the rows
      // the list still holds. That is not all of them: a picked folder's
      // files were never in the list, a row may have scrolled out of it, and
      // this very edit can take a row off it (the tag the list is filtered by,
      // removed). onApplied has the selection read those again, so reopening
      // this dialog tallies the tags as they now are.
      invalidateTagCatalog(qc);
      onApplied?.();
      onOpenChange(false);
      toast.success(
        t("select.tagsApplied", {
          files: result.files,
          added: result.added,
          removed: result.removed,
        }),
        result.skipped > 0
          ? { description: t("select.tagsSkipped", { count: result.skipped }) }
          : undefined,
      );
    },
    onError: (e: unknown) => {
      // main rejects a name that impersonates a pipeline-owned namespace; the
      // detail view explains that case rather than showing the raw error, and
      // the same edit should not read differently here.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes(RESERVED_TAG_ERROR)) {
        const offender = adding.find((name) => reservedTagPrefix(name));
        toast.error(
          t("tags.addFailedReserved", {
            prefix: (offender && reservedTagPrefix(offender)) ?? offender ?? "",
          }),
        );
        return;
      }
      // Past the name check each workspace commits on its own (see
      // files_bulk_tag), so the ones ahead of the failure may be written.
      invalidateTagCatalog(qc);
      onApplied?.();
      toast.error(t("select.tagsFailed", { msg }));
    },
  });

  const changeCount = adding.length + removing.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>{t("select.bulkTagTitle")}</DialogTitle>
          <DialogDescription>
            {t("select.bulkTagSubtitle", { count: total })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 pb-5">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="bulk-tag-input"
              className="text-xs font-bold text-fg"
            >
              {t("select.bulkTagAddLabel")}
            </label>
            <input
              id="bulk-tag-input"
              value={input}
              maxLength={MAX_TAG_NAME}
              disabled={atNameLimit}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  stageAdd(input, true);
                }
              }}
              placeholder={t("tag.addPlaceholder")}
              className="h-9 rounded-md border border-border-strong bg-bg px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
            {tooLong && (
              <p className="text-xs text-error">
                {t("tags.nameTooLong", { max: MAX_TAG_NAME })}
              </p>
            )}
            {atNameLimit && (
              <p className="text-xs text-muted">
                {t("select.bulkTagNameLimit", { max: MAX_BULK_TAG_NAMES })}
              </p>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => stageAdd(name, true)}
                    className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-fg transition hover:border-primary"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {stagedNew.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-fg">
                {t("select.bulkTagPending")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {stagedNew.map((name) => (
                  <span
                    key={name}
                    className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-primary pl-2 pr-1.5 text-xs font-bold text-primary-foreground"
                  >
                    <Plus className="size-3" strokeWidth={3} />
                    {name}
                    <button
                      type="button"
                      onClick={() =>
                        setAdding((prev) => prev.filter((n) => n !== name))
                      }
                      aria-label={t("select.bulkTagCancelAdd", { name })}
                      className="rounded p-0.5 transition hover:bg-bg/20"
                    >
                      <X className="size-3" strokeWidth={3} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-fg">
              {t("select.bulkTagExisting")}
            </span>
            {tally.length === 0 ? (
              <span className="text-xs text-muted">{t("tag.none")}</span>
            ) : (
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {tally.map(({ name, count }) => {
                  const staged = removing.includes(name);
                  const all = count === total;
                  const raised = adding.includes(name);
                  return (
                    <span
                      key={name}
                      className={cn(
                        "inline-flex h-[26px] items-center gap-1.5 rounded-md border pl-2 pr-1 text-xs",
                        staged
                          ? "border-error/60 bg-bg text-muted line-through"
                          : all || raised
                            ? "border-overlay bg-overlay text-fg"
                            : "border-dashed border-primary bg-bg text-fg",
                      )}
                    >
                      {/* Only a partial tag can be raised; one every file
                          already carries has nothing to level up to. */}
                      {!all && !staged && !raised ? (
                        <button
                          type="button"
                          onClick={() => stageAdd(name)}
                          title={t("select.bulkTagRaise", { name })}
                          className="transition hover:opacity-80"
                        >
                          {name}
                        </button>
                      ) : (
                        name
                      )}
                      <span
                        className={cn(
                          "text-[10px] font-bold tabular-nums",
                          all || raised ? "text-muted" : "text-primary",
                        )}
                      >
                        {raised ? total : count}/{total}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleRemove(name)}
                        aria-label={
                          staged
                            ? t("select.bulkTagKeep", { name })
                            : t("select.bulkTagRemove", { name })
                        }
                        title={
                          staged
                            ? t("select.bulkTagKeep", { name })
                            : t("select.bulkTagRemove", { name })
                        }
                        className="rounded p-0.5 text-muted transition hover:text-fg"
                      >
                        {staged ? (
                          <Undo2 className="size-3" strokeWidth={2.5} />
                        ) : (
                          <X className="size-3" strokeWidth={3} />
                        )}
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted">
              {t("select.bulkTagHint")}
            </p>
          </div>
        </div>

        <DialogFooter className="items-center border-t border-border p-4">
          <span
            className={cn(
              "mr-auto text-[11px]",
              tooManyFiles ? "text-error" : "text-muted",
            )}
          >
            {tooManyFiles
              ? t("select.bulkFileLimit", { max: MAX_BULK_FILES })
              : t("select.bulkTagChanges", {
                  added: adding.length,
                  removed: removing.length,
                })}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-sm text-fg transition hover:bg-overlay"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={
              changeCount === 0 ||
              apply.isPending ||
              total === 0 ||
              tooManyFiles
            }
            className="h-9 rounded-md border border-primary bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-default disabled:opacity-50"
          >
            {t("select.bulkTagApply", { count: total })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
