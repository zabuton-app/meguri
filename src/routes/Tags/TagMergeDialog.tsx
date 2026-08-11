// Fold several user-owned tags into one of them. The target is restricted to the
// selection rather than free text: "merge then rename" already covers the other
// case, and it keeps both the form and the main-process validation simple.
import { useState } from "react";
import type { TagSummary } from "@/ipc/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

/** The tag most files already carry is the least disruptive default target. */
function defaultTarget(tags: TagSummary[]): string {
  return tags.reduce(
    (best, tag) => (tag.fileCount > best.fileCount ? tag : best),
    tags[0],
  ).qualified;
}

export function TagMergeDialog({
  open,
  onOpenChange,
  tags,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected editable tags. The target must be one of them. */
  tags: TagSummary[];
  onMerge: (sources: TagSummary[], target: TagSummary) => void;
}) {
  const { t } = useI18n();
  // Derived rather than seeded in an effect: `tags` comes from a react-query
  // result, so its identity changes on every refetch and an effect keyed on it
  // would reset the user's choice mid-dialog. An explicit pick wins as long as
  // it is still in the list; otherwise the default applies.
  const [chosen, setChosen] = useState("");
  const target =
    tags.some((tag) => tag.qualified === chosen) || tags.length === 0
      ? chosen
      : defaultTarget(tags);

  const setVisible = (next: boolean) => {
    if (!next) setChosen("");
    onOpenChange(next);
  };

  const onSubmit = () => {
    const into = tags.find((tag) => tag.qualified === target);
    if (!into) return;
    setVisible(false);
    onMerge(
      tags.filter((tag) => tag.qualified !== into.qualified),
      into,
    );
  };

  return (
    <Dialog open={open} onOpenChange={setVisible}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader className="p-5 pb-3">
            <DialogTitle>{t("tags.mergeTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5 pb-5">
            <p className="text-sm text-muted">
              {t("tags.mergeDescription", { count: tags.length })}
            </p>
            <fieldset className="flex flex-col gap-1">
              <legend className="pb-1 text-xs font-medium text-muted">
                {t("tags.mergeTarget")}
              </legend>
              {tags.map((tag) => (
                <label
                  key={tag.qualified}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-fg/5"
                >
                  <input
                    type="radio"
                    name="merge-target"
                    className="size-3.5 shrink-0 accent-primary"
                    value={tag.qualified}
                    checked={target === tag.qualified}
                    onChange={() => setChosen(tag.qualified)}
                  />
                  <span className="truncate text-fg">{tag.qualified}</span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                    {t("tags.fileCount", { count: tag.fileCount })}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <DialogFooter className="border-t border-border p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setVisible(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!target}>
              {t("tags.mergeAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
