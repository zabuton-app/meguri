import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { api } from "@/ipc/client";
import { formatDateTime } from "@/lib/dates";
import { photoDetailRows } from "@shared/photoInfo";

/**
 * A photo's details as its EXIF gives them (#725), like a file's details in a
 * file manager: only the fields the photo has, read when the view opens.
 * Folded by default; nothing at all when the photo gives none.
 */
export function PhotoDetailsCard({
  id,
  workspaceId,
}: {
  id: number;
  workspaceId: string;
}) {
  const { t, lang } = useI18n();
  const { data } = useQuery({
    queryKey: ["file_photo_details", workspaceId, id],
    queryFn: () => api.filePhotoDetails(id, workspaceId),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!data) return null;
  const rows =
    data.status === "ok"
      ? photoDetailRows(data.details, (unix) =>
          formatDateTime(new Date(unix * 1000), lang),
        )
      : [];
  if (data.status === "ok" && rows.length === 0) return null;

  return (
    <section
      aria-label={t("photoDetails.title")}
      className="space-y-2 border-t border-border py-3 text-sm"
    >
      <details>
        <summary className="cursor-pointer font-semibold text-bright-fg">
          {t("photoDetails.title")}
        </summary>
        {data.status === "unreadable" ? (
          <p className="mt-2 text-muted">{t("photoDetails.unreadable")}</p>
        ) : (
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {rows.map((row) => (
              <div key={row.key} className="contents">
                <dt className="text-muted">
                  {t(`photoDetails.field.${row.key}` as TranslationKey)}
                </dt>
                <dd className="select-text break-words">
                  {row.valueKey
                    ? t(`photoDetails.${row.valueKey}` as TranslationKey)
                    : row.equiv35
                      ? `${row.value} (${t("media.metaFocalEquiv", { mm: row.equiv35 })})`
                      : row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </details>
    </section>
  );
}
