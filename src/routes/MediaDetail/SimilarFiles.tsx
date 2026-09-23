// Nearest neighbours of the open file by AI embedding. Rendered only while a
// model is active, and empty until the file itself has been analyzed — there is
// nothing to be near to before that.
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/ipc/client";
import { fileHref } from "@/lib/fileHref";
import { aiSimilarKey } from "@/lib/queryCache";
import type { TFunc } from "@/i18n/I18nProvider";

interface Props {
  id: number;
  wsId: string;
  mediaBase: string;
  t: TFunc;
}

const LIMIT = 16;

export function SimilarFiles({ id, wsId, mediaBase, t }: Props) {
  const similar = useQuery({
    queryKey: aiSimilarKey(wsId, id),
    queryFn: () => api.aiSimilar(id, wsId, LIMIT),
    staleTime: 60_000,
  });
  if (!similar.data) return null;
  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase text-muted">
        {t("media.similar")}
      </h3>
      {similar.data.length === 0 ? (
        <p className="px-1 text-xs text-muted">{t("media.similarNone")}</p>
      ) : (
        <ScrollArea className="w-full" viewportClassName="pb-3">
          <div className="flex gap-2">
            {similar.data.map((hit) => (
              <Link
                key={`${hit.workspaceId}:${hit.id}`}
                to={fileHref(hit.id, hit.workspaceId, { from: "similar" })}
                className="relative block h-20 w-32 shrink-0 overflow-hidden rounded-md border border-border bg-overlay"
                title={`${Math.round(hit.score * 100)}%`}
              >
                <img
                  src={`${mediaBase}/ws/${hit.workspaceId}/thumb/${hit.id}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {/* Cosine similarity as a percentage: useful for telling a near
                    duplicate from a loose match at a glance. */}
                <span className="absolute right-1 bottom-1 rounded bg-bg/80 px-1 font-mono text-[10px] text-fg">
                  {Math.round(hit.score * 100)}
                </span>
              </Link>
            ))}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
