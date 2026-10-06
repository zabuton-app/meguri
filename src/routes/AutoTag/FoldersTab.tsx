// Folders tab: the folder rules — a folder of a workspace, and the tags
// everything under it gets — and the pane beside them editing whichever is
// selected.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import { cn } from "@/lib/utils";
import { MAX_AUTO_TAG_FOLDER_RULES, type FolderRule } from "@shared/autoTag";
import { ALL_ID } from "@shared/workspaceIds";
import { FolderEditor, type FolderWorkspace } from "./FolderEditor";
import { MAX_ROWS, MONO, folderCountKey, folderCounts } from "./helpers";
import { MoreRows, SplitPane } from "./parts";
import type { AutoTagState } from "./useAutoTag";
import { useViewState } from "./viewState";

export function FoldersTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const { config, update, existing } = state;
  const [selection, setSelection] = useViewState<string | null>(
    "folders.selection",
    null,
  );

  // What is selected, falling back to the first rule when nothing is, or when
  // the selected one was deleted.
  const shown =
    config.folders.find((rule) => rule.id === selection) ?? config.folders[0];

  // The workspaces a folder rule can be for: all of them, whichever one the
  // library is showing — named as the rest of the app names them.
  const workspacesList = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
    staleTime: 30_000,
  });
  const workspaceLabels = useMemo(
    () =>
      new Map(
        (workspacesList.data?.workspaces ?? []).map((w) => [w.id, w.label]),
      ),
    [workspacesList.data],
  );
  // A rule may be for a workspace that is gone: named all the same.
  const workspaceLabel = (id: string): string => workspaceLabels.get(id) ?? id;
  const folderWorkspaces = useMemo(
    (): FolderWorkspace[] =>
      // The real ones: "All" is a view over them, not a place files are in.
      (workspacesList.data?.workspaces ?? [])
        .filter((w) => w.id !== ALL_ID)
        .map((w) => ({ id: w.id, label: w.label })),
    [workspacesList.data],
  );
  // Files under each folder, counted once for the whole list of rules.
  const underFolder = useMemo(() => folderCounts(state.files), [state.files]);
  const folderFileCount = (rule: FolderRule): number =>
    underFolder.get(folderCountKey(rule.workspaceId, rule.folder)) ?? 0;

  const patchFolder = (id: string, change: Partial<FolderRule>) =>
    update((c) => ({
      ...c,
      folders: c.folders.map((rule) =>
        rule.id === id ? { ...rule, ...change } : rule,
      ),
    }));
  const addFolder = () => {
    const workspaceId = folderWorkspaces[0]?.id;
    if (!workspaceId) return;
    const id = crypto.randomUUID();
    update((c) => ({
      ...c,
      folders: [
        ...c.folders,
        { id, workspaceId, folder: "", tags: [], enabled: true },
      ],
    }));
    setSelection(id);
  };
  const deleteFolder = (id: string) => {
    update((c) => ({
      ...c,
      folders: c.folders.filter((rule) => rule.id !== id),
    }));
    setSelection(null);
  };

  return (
    <SplitPane
      aside={
        <div className="flex flex-col gap-0.5 p-3">
          <div className="flex items-baseline gap-2 px-1 pb-2 pt-0.5">
            <span className="text-xs font-semibold text-fg">
              {t("autoTag.folders")}
            </span>
            <span className="text-xs tabular-nums text-muted">
              {config.folders.length}
            </span>
            <span className="truncate text-xs text-muted">
              {t("autoTag.foldersHint")}
            </span>
          </div>
          {config.folders.slice(0, MAX_ROWS).map((rule) => (
            <div
              key={rule.id}
              className={cn(
                "flex items-center gap-2.5 rounded-lg p-2",
                shown?.id === rule.id ? "bg-overlay" : "hover:bg-surface",
              )}
            >
              <Switch
                checked={rule.enabled}
                onCheckedChange={(enabled) => patchFolder(rule.id, { enabled })}
                aria-label={t("autoTag.folderEnabled")}
              />
              <button
                type="button"
                onClick={() => setSelection(rule.id)}
                aria-current={shown?.id === rule.id}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      MONO,
                      "truncate text-[13px]",
                      rule.enabled ? "text-bright-fg" : "text-muted",
                    )}
                  >
                    {workspaceLabel(rule.workspaceId)}
                    {rule.folder && ` / ${rule.folder}`}
                  </span>
                  <span className="truncate text-[11px] text-muted">
                    {rule.tags.join(", ") || t("autoTag.folder.noTagsShort")}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {t("autoTag.fileCount", { count: folderFileCount(rule) })}
                </span>
              </button>
            </div>
          ))}
          <MoreRows t={t} hidden={config.folders.length - MAX_ROWS} />
          {config.folders.length === 0 && (
            <p className="px-1 pb-1 text-xs text-muted">
              {t("autoTag.noFolders")}
            </p>
          )}
          <button
            type="button"
            onClick={addFolder}
            disabled={
              folderWorkspaces.length === 0 ||
              config.folders.length >= MAX_AUTO_TAG_FOLDER_RULES
            }
            className="mt-2 h-8 rounded-lg border border-dashed border-border-strong text-xs text-muted transition hover:text-bright-fg disabled:opacity-40"
          >
            {t("autoTag.addFolder")}
          </button>
        </div>
      }
    >
      {shown && (
        <FolderEditor
          // Per rule: the search and the tag being typed belong to this one.
          key={shown.id}
          rule={shown}
          workspaces={folderWorkspaces}
          files={state.files}
          existing={existing}
          workspaceLabel={workspaceLabel(shown.workspaceId)}
          onChange={(change) => patchFolder(shown.id, change)}
          onDelete={() => deleteFolder(shown.id)}
        />
      )}
    </SplitPane>
  );
}
