// Bottom status bar: last scan time, visible file count, and processing status.
// File count and last-scan come from `workspaceStats` IPC (refetched on workspace
// switch and after scans complete). The processing indicator subscribes to scan
// events directly so the phase and progress reflect in real time.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, RefreshCw, Clock } from "lucide-react";
import { api, events } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";

const PHASE_KEY: Record<string, TranslationKey> = {
  walk: "scan.phaseWalk",
  hash: "scan.phaseHash",
  index: "scan.phaseIndex",
  thumbnail: "scan.phaseThumbnail",
  tags: "scan.phaseTags",
};

interface ProgressState {
  phase: string;
  done: number;
  total: number;
}

/** Locale-aware short timestamp (e.g. "2026-06-27 14:32"). Null/undefined → fallback. */
function formatLastScan(t: number | null | undefined): string | null {
  if (!t) return null;
  const d = new Date(t * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StatusBar({
  workspaceId,
  scanning,
}: {
  workspaceId: string | null | undefined;
  scanning: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<ProgressState | null>(null);

  // Refetch on workspace switch by keying on workspaceId.
  const stats = useQuery({
    queryKey: ["workspace_stats", workspaceId ?? null],
    queryFn: api.workspaceStats,
    enabled: workspaceId != null,
  });

  // Subscribe once on mount: avoid re-subscribing on every render (scan:progress
  // fires many times a second). Use the query client to invalidate stats so the
  // effect doesn't need a closure over the (per-render) `stats` object.
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    void events
      .onScanProgress((p) =>
        setProgress({ phase: p.phase, done: p.done, total: p.total }),
      )
      .then((u) => unlistens.push(u));
    void events
      .onScanDone(() => {
        setProgress(null);
        void qc.invalidateQueries({ queryKey: ["workspace_stats"] });
      })
      .then((u) => unlistens.push(u));
    void events
      .onWorkspaceChanged(() => {
        void qc.invalidateQueries({ queryKey: ["workspace_stats"] });
      })
      .then((u) => unlistens.push(u));
    return () => {
      unlistens.forEach((u) => u());
    };
  }, [qc]);

  const lastScanLabel = formatLastScan(stats.data?.lastScanAt);
  const fileCount = stats.data?.fileCount ?? 0;

  let processing: string;
  if (scanning || progress) {
    const phaseLabel =
      progress && PHASE_KEY[progress.phase]
        ? t(PHASE_KEY[progress.phase])
        : t("statusbar.scanning");
    if (progress && progress.total > 0) {
      processing = `${phaseLabel} ${progress.done}/${progress.total}`;
    } else if (progress && progress.done > 0) {
      processing = `${phaseLabel} ${progress.done}`;
    } else {
      processing = phaseLabel;
    }
  } else {
    processing = t("statusbar.idle");
  }

  return (
    <footer
      className="flex items-center justify-between gap-4 border-t border-border bg-bg px-4 py-1 text-xs text-muted"
      aria-label={t("statusbar.label")}
    >
      <div className="flex items-center gap-4 overflow-hidden">
        <span
          className="flex items-center gap-1.5"
          title={t("statusbar.lastScan")}
        >
          <Clock size={12} className="shrink-0 opacity-70" aria-hidden />
          <span className="truncate">
            {t("statusbar.lastScan")}:{" "}
            {lastScanLabel ?? t("statusbar.lastScanNever")}
          </span>
        </span>
        <span
          className="flex items-center gap-1.5"
          title={t("statusbar.fileCount")}
        >
          <Database size={12} className="shrink-0 opacity-70" aria-hidden />
          <span>
            {t("statusbar.fileCount", { count: fileCount.toLocaleString() })}
          </span>
        </span>
      </div>
      <span
        className="flex items-center gap-1.5"
        aria-live="polite"
        title={t("statusbar.status")}
      >
        <RefreshCw
          size={12}
          aria-hidden
          className={
            scanning || progress ? "animate-spin text-primary" : "opacity-70"
          }
        />
        <span className="truncate">{processing}</span>
      </span>
    </footer>
  );
}
