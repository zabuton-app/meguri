// Above the three condition tabs: whether a scan applies the conditions, and a
// pass over the files already in the library. One bar for all three, since
// both act on every condition at once.
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { AutoTagConfig } from "@shared/autoTag";
import { Notice, SmallButton, Toolbar } from "./parts";
import type { AutoTagState } from "./useAutoTag";

export function ApplyToolbar({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { config, update } = state;
  const [busy, setBusy] = useState(false);
  // The result line speaks of the conditions as they were when it ran: an
  // edit since makes it stale, so it is kept with the configuration it is of
  // and shown while that is still the one on screen. Any change to the
  // configuration — on whichever tab, even to the switch above — takes it
  // away; `update` always makes a new one.
  const [result, setResult] = useState<{
    of: AutoTagConfig;
    files: number;
    added: number;
  } | null>(null);

  const reapply = async () => {
    const ok = await confirm({
      title: t("autoTag.reapply"),
      message: t("autoTag.reapplyConfirm", { count: state.total }),
      confirmText: t("autoTag.reapply"),
    });
    if (!ok) return;
    setBusy(true);
    const outcome = await state.reapply();
    setBusy(false);
    setResult(outcome ? { of: config, ...outcome } : null);
  };

  return (
    <>
      <Toolbar>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
          <Switch
            checked={config.applyOnScan}
            onCheckedChange={(applyOnScan) =>
              update((c) => ({ ...c, applyOnScan }))
            }
          />
          {t("autoTag.applyOnScan")}
        </label>
        <span className="text-xs text-muted">
          {t("autoTag.applyOnScanHint")}
        </span>
        <SmallButton
          className="ml-auto"
          disabled={busy}
          onClick={() => void reapply()}
        >
          {busy ? t("autoTag.reapplying") : t("autoTag.reapply")}
        </SmallButton>
      </Toolbar>
      {result && result.of === config && (
        <Notice>
          {t("autoTag.reapplyDone", {
            files: result.files,
            added: result.added,
          })}
        </Notice>
      )}
    </>
  );
}
