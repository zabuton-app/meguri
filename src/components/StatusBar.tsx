// Bottom status bar (always the lowest strip of the window). Left: the scope's
// file total, the folders shown (while browsing by folder) and the files shown.
// Right: last scan time and processing status.
// Total and last-scan come from `workspaceStats` IPC (refetched on workspace
// switch and after scans complete). The processing indicator subscribes to scan
// events directly so the phase and progress reflect in real time.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Database, Eye, Folder, RefreshCw } from "lucide-react";
import { api, events } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useScanning } from "@/hooks/useScanning";
import { useListCounts } from "@/hooks/useListCounts";
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

export function StatusBar() {
  const { t } = useI18n();
  // Mounted in App (below the audio player bar, outside the router), so the
  // inputs Home used to pass as props are read from their shared sources.
  const workspaceId = useAppStatus().data?.workspaceId;
  const scanning = useScanning();
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
  // The scope's total, what the view is showing of it, and — while browsing
  // a folder — the folders shown beside the files (see useListCounts).
  const counts = useListCounts();
  const total = stats.data?.fileCount ?? 0;
  const shown = counts?.files ?? total;
  const totalLabel = t("statusbar.total", { count: total.toLocaleString() });
  const shownLabel = t("statusbar.shown", {
    count: `${shown.toLocaleString()}${counts?.more ? "+" : ""}`,
  });
  const foldersLabel =
    counts?.folders != null
      ? t("statusbar.folders", { count: counts.folders.toLocaleString() })
      : null;

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
      data-slot="status-bar"
      className="flex items-center justify-between gap-4 border-t border-border bg-bg px-4 py-1 text-xs text-muted"
      aria-label={t("statusbar.label")}
    >
      <div className="flex items-center gap-4 overflow-hidden">
        <span className="flex items-center gap-1.5" title={totalLabel}>
          <Database size={12} className="shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{totalLabel}</span>
        </span>
        {foldersLabel && (
          <span className="flex items-center gap-1.5" title={foldersLabel}>
            <Folder size={12} className="shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{foldersLabel}</span>
          </span>
        )}
        <span className="flex items-center gap-1.5" title={shownLabel}>
          <Eye size={12} className="shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{shownLabel}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
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
      </div>
    </footer>
  );
}
