// Listens for the main process's "update:available" event (pushed by the
// startup check or the tray "Check for Updates" item) and surfaces a toast with
// actions to open the release page or skip the version.
import { useEffect } from "react";
import { toast } from "sonner";
import { api, events, type UpdateInfo } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";

export function useUpdateNotifier(): void {
  const { t } = useI18n();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;

    const show = (info: UpdateInfo) => {
      toast.info(t("update.available", { version: info.latest }), {
        id: "update-available",
        description: t("update.availableDesc", { current: info.current }),
        duration: Infinity,
        action: {
          label: t("update.view"),
          onClick: () => void api.openUrl(info.url),
        },
        cancel: {
          label: t("update.skip"),
          onClick: () => void api.updateIgnore(info.latest),
        },
      });
    };

    void events.onUpdateAvailable(show).then((un) => {
      // The component may have unmounted before the (sync) listener resolved.
      if (active) unlisten = un;
      else un();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [t]);
}
