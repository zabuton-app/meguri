import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";

export function DownloadOriginCard({
  id,
  workspaceId,
}: {
  id: number;
  workspaceId: string;
}) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["file_download_origin", workspaceId, id],
    queryFn: () => api.fileDownloadOrigin(id, workspaceId),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!data?.length) return null;

  // Prefer the browser page's host over the host that served the file.
  const website = data.find((entry) => entry.kind === "referrer") ?? data[0];

  return (
    <section
      aria-label={t("downloadOrigin.title")}
      className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm"
    >
      <h2 className="font-semibold text-bright-fg">
        {t("downloadOrigin.title")}
      </h2>
      <p className="break-all">
        <span className="me-2 text-muted">{t("downloadOrigin.website")}</span>
        <span className="font-medium">{website.hostname}</span>
      </p>
      <details className="space-y-2">
        <summary className="cursor-pointer">
          {t("downloadOrigin.recorded")}
        </summary>
        <ul className="space-y-2">
          {data.map(({ kind, url }, index) => {
            const label = t(`downloadOrigin.${kind}`);
            return (
              <li key={index} className="space-y-1 border-t border-border pt-2">
                <p className="text-muted">{label}</p>
                <p className="select-text break-all">{url}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("downloadOrigin.copyLabel", { label })}
                    onClick={() => {
                      void navigator.clipboard.writeText(url).then(
                        () => toast.success(t("downloadOrigin.copied")),
                        () => toast.error(t("downloadOrigin.copyFailed")),
                      );
                    }}
                  >
                    {t("downloadOrigin.copy")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("downloadOrigin.openLabel", { label })}
                    onClick={() => {
                      void api.openUrl(url).catch(() => {
                        toast.error(t("downloadOrigin.openFailed"));
                      });
                    }}
                  >
                    {t("fileMenu.open")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
