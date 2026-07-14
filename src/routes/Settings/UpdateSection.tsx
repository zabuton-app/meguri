// Settings: update-check controls. Shows the current version, an auto-check
// toggle, and a manual "check now" button that reports the result inline.
import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, type UpdateInfo } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "result"; info: UpdateInfo }
  | { status: "error" };

export function UpdateSection() {
  const { t } = useI18n();
  const [autoCheck, setAutoCheck] = useState(true);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  useEffect(() => {
    let active = true;
    void api.updateGetSettings().then((s) => {
      if (active) setAutoCheck(s.autoCheck);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleAutoCheck = useCallback((next: boolean) => {
    setAutoCheck(next);
    void api.updateSetAutoCheck(next);
  }, []);

  const checkNow = useCallback(() => {
    setCheck({ status: "checking" });
    void api
      .updateCheck(true)
      .then((info) =>
        setCheck(info ? { status: "result", info } : { status: "error" }),
      )
      .catch(() => setCheck({ status: "error" }));
  }, []);

  const info = check.status === "result" ? check.info : null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-bright-fg">
            {t("settings.update")}
          </span>
          <span className="text-xs text-muted">{t("settings.updateDesc")}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={checkNow}
          disabled={check.status === "checking"}
        >
          {check.status === "checking" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t("settings.updateCheckNow")}
        </Button>
      </div>

      {/* Auto-check toggle */}
      <div className="flex items-center justify-between gap-3 text-sm text-fg">
        <label htmlFor="update-auto-check" className="cursor-pointer">
          {t("settings.updateAuto")}
        </label>
        <Switch
          id="update-auto-check"
          checked={autoCheck}
          onCheckedChange={toggleAutoCheck}
        />
      </div>

      {/* Result line */}
      {check.status === "checking" && (
        <p className="text-xs text-muted">{t("update.checking")}</p>
      )}
      {check.status === "error" && (
        <p className="text-xs text-muted">{t("update.checkFailed")}</p>
      )}
      {info && info.available && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-xs text-fg">
            {t("update.available", { version: info.latest })}
          </span>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => void api.openUrl(info.url)}
          >
            <Download className="size-4" />
            {t("update.view")}
          </Button>
        </div>
      )}
      {info && !info.available && (
        <p className="text-xs text-muted">
          {t("update.upToDate", { version: info.current })}
        </p>
      )}
    </section>
  );
}
