// Settings: each workspace's excluded folders at a glance (#529), next to the
// patterns, with its edit dialog a click away. The folders themselves are
// edited there (and added from the folder view).
import { useId, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceEditDialog } from "@/components/WorkspaceEditDialog";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import type { WorkspaceInfo } from "@/ipc/types";
import { ALL_ID } from "@shared/workspaceIds";

export function FolderExclusionsSection() {
  const { t } = useI18n();
  const headingId = useId();
  const [editing, setEditing] = useState<WorkspaceInfo | null>(null);
  const list = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  // Not "All": it has no folders of its own.
  const workspaces = useMemo(
    () => (list.data?.workspaces ?? []).filter((w) => w.id !== ALL_ID),
    [list.data],
  );
  const folders = useQueries({
    queries: workspaces.map((w) => ({
      queryKey: ["scan_exclusion_folders", w.id],
      queryFn: () => api.scanExclusionsFolders(w.id),
    })),
  });

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-md border border-border bg-surface"
    >
      <div className="flex flex-col px-4 py-3">
        <h3
          id={headingId}
          className="flex items-center gap-2 text-sm font-semibold text-bright-fg"
        >
          {t("settings.folderExclusions")}
          <span className="inline-flex h-5 items-center rounded-full border border-border-strong px-2 text-[11px] font-medium text-muted">
            {t("settings.folderExclusionsPerWorkspace")}
          </span>
        </h3>
        <span className="text-xs text-muted">
          {t("settings.folderExclusionsDesc")}
        </span>
      </div>
      {list.isError ? (
        <p className="px-4 pb-3 text-xs text-error">
          {t("settings.folderExclusionsLoadError")}
        </p>
      ) : list.data && workspaces.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted">
          {t("settings.folderExclusionsNoWorkspaces")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {workspaces.map((w, i) => {
            const q = folders[i];
            const listed = q?.data?.folders ?? [];
            const missing = listed.filter((f) => !f.found).length;
            return (
              <li
                key={w.id}
                className="flex items-center gap-3 border-t border-border px-4 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md bg-overlay text-base leading-none text-muted [&>svg]:size-4"
                >
                  {w.emoji ?? <FolderOpen />}
                </span>
                {/* w-0: the long path must not widen the settings scroll
                    area, which grows to its content's minimum width. */}
                <span className="flex w-0 min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-bright-fg">
                    {w.label}
                  </span>
                  <span
                    title={w.path}
                    className="truncate font-mono text-[11px] text-muted"
                  >
                    {w.path}
                  </span>
                </span>
                {q?.isError ? (
                  <span className="shrink-0 text-xs text-error">
                    {t("settings.folderExclusionsLoadError")}
                  </span>
                ) : (
                  q?.data && (
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
                      <span
                        className={listed.length > 0 ? "text-fg" : "text-muted"}
                      >
                        {listed.length > 0
                          ? t("settings.folderExclusionsCount", {
                              count: listed.length,
                            })
                          : t("settings.folderExclusionsNone")}
                      </span>
                      {missing > 0 && (
                        <span className="inline-flex h-5 items-center rounded-full bg-warn/15 px-2 text-[11px] font-medium text-warn">
                          {t("settings.folderExclusionsNotFound", {
                            count: missing,
                          })}
                        </span>
                      )}
                    </span>
                  )
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  aria-label={t("settings.folderExclusionsManageLabel", {
                    name: w.label,
                  })}
                  onClick={() => setEditing(w)}
                >
                  {t("settings.folderExclusionsManage")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <WorkspaceEditDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        workspace={editing}
      />
    </section>
  );
}
