// Scan progress bar. Subscribes to scan IPC events and shows the walk/thumbnail phases.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, events, ALL_ID } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import type { ThumbDone } from "@/ipc/client";
import type { TranslationKey } from "@/i18n/locales/ja";

interface ProgressState {
  phase: string;
  done: number;
  total: number;
  active: boolean;
}

const PHASE_KEY: Record<string, TranslationKey> = {
  walk: "scan.phaseWalk",
  hash: "scan.phaseHash",
  index: "scan.phaseIndex",
  thumbnail: "scan.phaseThumbnail",
};

export function ScanProgress({
  onThumbDone,
  wsId,
}: {
  onThumbDone?: (event: ThumbDone) => void;
  wsId?: string | null;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ProgressState>({
    phase: "",
    done: 0,
    total: 0,
    active: false,
  });

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    void events
      .onScanProgress((p) =>
        setState({
          phase: p.phase,
          done: p.done,
          total: p.total,
          active: true,
        }),
      )
      .then((u) => unlistens.push(u));

    void events
      .onThumbDone((event) => onThumbDone?.(event))
      .then((u) => unlistens.push(u));

    void events
      .onScanDone(() => {
        hideTimer = setTimeout(
          () => setState((s) => ({ ...s, active: false })),
          1200,
        );
      })
      .then((u) => unlistens.push(u));

    return () => {
      unlistens.forEach((u) => u());
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [onThumbDone]);

  if (!state.active) return null;

  // total === 0 means the total is not yet known (e.g. during walk): show an
  // indeterminate bar and just the running count instead of a percentage.
  const indeterminate = state.total <= 0;
  const pct = indeterminate ? 0 : Math.round((state.done / state.total) * 100);

  return (
    <div className="fixed bottom-[calc(2.5rem+var(--meguri-player-bar-h))] left-4 z-30 w-72 rounded-md border border-border bg-surface px-3 py-2 shadow-lg shadow-black/25">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="truncate">
          {PHASE_KEY[state.phase] ? t(PHASE_KEY[state.phase]) : state.phase}{" "}
          {indeterminate ? state.done : `${state.done}/${state.total}`}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span>{indeterminate ? "…" : `${pct}%`}</span>
          <button
            type="button"
            onClick={() =>
              void api.scanCancel(wsId && wsId !== ALL_ID ? wsId : undefined)
            }
            title={t("scan.cancel")}
            aria-label={t("scan.cancel")}
            className="rounded p-0.5 text-muted hover:bg-overlay hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded bg-overlay">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded bg-primary" />
        ) : (
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
