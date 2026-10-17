// When a condition's tag is renamed: the files it reaches that carry the old
// tag can be moved to the new one, after a question. Like taking a tag off,
// it goes by what the files carry — nothing records which tags a condition
// gave — and declining leaves the files as they are, to be edited by hand.
// The outcome is a toast: the Keywords and Folders tabs have no notice line.
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { AutoTagState } from "./useAutoTag";

/**
 * `migrate(indexes, from, to)`: of the files at `indexes` (the ones the
 * condition reaches), those carrying `from` get `to` in its place.
 */
export function useTagMigration(state: AutoTagState) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { fileTags, retag } = state;
  // Past the cap only a sample is loaded, and only that can be looked at.
  const loaded = state.files.length;
  const sampled = state.total > loaded;
  const running = useRef(false);
  return useCallback(
    async (indexes: readonly number[], from: string, to: string) => {
      const fromKey = from.toLowerCase();
      // Another spelling of the same tag: the files' tag is that one already.
      if (fromKey === to.toLowerCase() || running.current) return;
      const holders = indexes.filter((index) => fileTags[index].has(fromKey));
      if (holders.length === 0) return;
      running.current = true;
      try {
        const ok = await confirm({
          title: t("autoTag.migrate.title", { to }),
          message:
            t("autoTag.migrate.message", { from, to, count: holders.length }) +
            (sampled ? t("autoTag.migrate.sampled", { count: loaded }) : ""),
          confirmText: t("autoTag.migrate.confirm", { count: holders.length }),
          cancelText: t("autoTag.migrate.cancel"),
        });
        if (!ok) return;
        const outcome = await retag(holders, fromKey, to);
        if (!outcome.ok) return;
        toast.success(
          t("autoTag.migrate.done", { from, to, count: outcome.files }),
        );
      } finally {
        running.current = false;
      }
    },
    [confirm, fileTags, loaded, retag, sampled, t],
  );
}
