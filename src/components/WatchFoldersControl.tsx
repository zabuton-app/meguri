import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderSync } from "lucide-react";
import { api, events } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function WatchFoldersControl({ ready }: { ready: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["watch_get"],
    queryFn: () => api.watchGet(),
    enabled: ready,
  });
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.watchSet(enabled),
    onSuccess: (value) => qc.setQueryData(["watch_get"], value),
  });
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void events
      .onWatchChanged((value) => qc.setQueryData(["watch_get"], value))
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ready, qc]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("watch.title")}
          title={t("watch.title")}
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-fg"
        >
          <FolderSync className="size-4" />
          <span className="hidden lg:inline">{t("watch.title")}</span>
          <span
            className={status.data?.enabled ? "text-primary" : "text-muted"}
          >
            {status.data?.enabled ? status.data.watched : t("watch.off")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={t("watch.title")} className="w-80 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={status.data?.enabled ?? false}
            disabled={!status.data || change.isPending}
            onChange={(event) => change.mutate(event.target.checked)}
          />
          {t("watch.enable")}
        </label>
        <p className="text-xs text-muted">{t("watch.hint")}</p>
        {status.data?.enabled && (
          <p className="text-xs text-muted">
            {t("watch.count", { count: status.data.watched })}
          </p>
        )}
        {!!status.data?.unavailable.length && (
          <p role="status" className="text-xs text-error">
            {t("watch.unavailable", { count: status.data.unavailable.length })}
          </p>
        )}
        {(status.error || change.error) && (
          <p role="alert" className="text-xs text-error">
            {t("watch.error")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
