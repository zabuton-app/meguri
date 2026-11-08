// Says, once a window, that the library was found damaged at startup and a
// copy put back (main's maintainLibrary, app_status.libraryRestoredFrom):
// anything changed after that copy was taken is gone.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useI18n } from "@/i18n/I18nProvider";

export function useLibraryRestoreNotifier(): void {
  const { t } = useI18n();
  const from = useAppStatus().data?.libraryRestoredFrom;
  const told = useRef(false);

  useEffect(() => {
    if (from === undefined || told.current) return;
    told.current = true;
    toast.warning(
      t("library.restored", { date: new Date(from * 1000).toLocaleString() }),
      { description: t("library.restoredDesc"), duration: Infinity },
    );
  }, [from, t]);
}
