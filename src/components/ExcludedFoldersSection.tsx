// The folders a workspace's scans leave out (#282, #529), in its edit dialog.
// Changes are staged: a folder taken off stays listed, struck through, until
// the dialog is saved (or the change undone), and so does a folder picked to
// add, so the user sees what saving will do.
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { FolderX, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import { cn } from "@/lib/utils";
import type { ExcludedFolders } from "@shared/ipc/channels";

export interface StagedFolder {
  path: string;
  absPath: string;
}

type Row = ExcludedFolders["folders"][number] & {
  state: "excluded" | "including" | "adding";
};

export function ExcludedFoldersSection({
  workspaceId,
  root,
  excluded,
  included,
  onIncludedChange,
  added,
  onAddedChange,
}: {
  workspaceId: string;
  /** The workspace root, dimmed at the start of each path. */
  root: string;
  excluded: UseQueryResult<ExcludedFolders>;
  /** Listed folders to take off on save. */
  included: ReadonlySet<string>;
  onIncludedChange: (next: ReadonlySet<string>) => void;
  /** Folders picked to add on save. */
  added: readonly StagedFolder[];
  onAddedChange: (next: StagedFolder[]) => void;
}) {
  const { t } = useI18n();
  const listed = excluded.data?.folders ?? [];
  const rows: Row[] = [
    ...listed.map((f): Row => ({
      ...f,
      state: included.has(f.path) ? "including" : "excluded",
    })),
    ...added.map((f): Row => ({ ...f, found: true, state: "adding" })),
  ];
  const active = rows.filter((r) => r.state !== "including").length;

  const toggle = (row: Row) => {
    if (row.state === "adding") {
      onAddedChange(added.filter((f) => f.path !== row.path));
      return;
    }
    const next = new Set(included);
    if (next.has(row.path)) next.delete(row.path);
    else next.add(row.path);
    onIncludedChange(next);
  };

  const pick = async () => {
    let picked;
    try {
      picked = await api.scanExclusionsPickFolder(workspaceId);
    } catch (e) {
      console.error("pick folder failed:", e);
      toast.error(t("workspace.excludedFolderPickFailed"));
      return;
    }
    if (picked.status === "canceled") return;
    if (picked.status === "outside") {
      toast.error(t("workspace.excludedFolderOutside"));
      return;
    }
    const { path, absPath } = picked;
    if (listed.some((f) => f.path === path)) {
      // Listed already: picking it again keeps it excluded.
      if (included.has(path)) {
        const next = new Set(included);
        next.delete(path);
        onIncludedChange(next);
      }
      return;
    }
    if (added.some((f) => f.path === path)) return;
    onAddedChange([...added, { path, absPath }]);
  };

  return (
    <section className="flex flex-col gap-2.5 px-5 pb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-bright-fg">
            {t("workspace.excludedFolders")}
            {excluded.data && (
              <span
                data-testid="excluded-folder-count"
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-overlay px-1.5 text-[11px] font-semibold"
              >
                {active}
              </span>
            )}
          </h3>
          <p className="text-xs text-muted">
            {t("workspace.excludedFoldersDesc")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!excluded.data}
          onClick={() => void pick()}
        >
          <Plus />
          {t("workspace.excludedFoldersAdd")}
        </Button>
      </div>

      {excluded.isError ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-md bg-error/10 px-3 py-2 text-xs text-error"
        >
          <span className="flex-1">
            {t("workspace.excludedFoldersLoadError")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void excluded.refetch()}
          >
            {t("workspace.excludedFoldersRetry")}
          </Button>
        </div>
      ) : excluded.data && rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong px-4 py-5 text-center text-xs text-muted">
          {t("workspace.excludedFoldersEmpty")}
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border">
          {rows.map((row) => (
            <FolderItem
              key={`${row.state === "adding" ? "+" : ""}${row.path}`}
              row={row}
              root={root}
              onToggle={() => toggle(row)}
            />
          ))}
        </ul>
      )}

      {included.size > 0 && (
        <p className="text-xs text-primary">
          {t("workspace.excludedFoldersNextScan")}
        </p>
      )}
    </section>
  );
}

function FolderItem({
  row,
  root,
  onToggle,
}: {
  row: Row;
  root: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const name = row.path.slice(row.path.lastIndexOf("/") + 1);
  // The root dimmed, so the part that picks the folder out stands out.
  const inRoot = root !== "" && row.absPath.startsWith(root);
  const staged = row.state !== "excluded";
  const missing = !row.found && row.state === "excluded";
  return (
    <li
      title={row.absPath}
      className={cn(
        "flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0",
        staged && "bg-primary/5",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md bg-overlay [&>svg]:size-4",
          row.state === "including"
            ? "text-muted"
            : missing
              ? "text-warn"
              : "text-fg",
        )}
      >
        <FolderX />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "min-w-0 truncate text-sm font-semibold",
              row.state === "including"
                ? "text-muted line-through"
                : "text-bright-fg",
            )}
          >
            {name}
          </span>
          {missing && (
            <Badge className="bg-warn/15 text-warn">
              {t("workspace.excludedFolderNotFound")}
            </Badge>
          )}
          {row.state === "including" && (
            <Badge className="bg-primary/15 text-primary">
              {t("workspace.excludedFolderIncluding")}
            </Badge>
          )}
          {row.state === "adding" && (
            <Badge className="bg-primary/15 text-primary">
              {t("workspace.excludedFolderAdding")}
            </Badge>
          )}
        </span>
        <span
          // Wrapped, not cut short: the end of the path is the folder, and
          // its start says which one.
          className="break-all font-mono text-[11px] leading-snug text-muted"
        >
          {inRoot ? (
            <>
              <span className="opacity-70">{root}</span>
              {row.absPath.slice(root.length)}
            </>
          ) : (
            row.absPath
          )}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={
          staged
            ? t("workspace.excludedFolderUndoLabel", { path: row.absPath })
            : row.found
              ? t("workspace.excludedFolderInclude", { path: row.absPath })
              : t("workspace.excludedFolderRemove", { path: row.absPath })
        }
        onClick={onToggle}
      >
        {staged ? (
          t("workspace.excludedFolderUndo")
        ) : (
          <>
            <Undo2 />
            {row.found
              ? t("workspace.excludedFolderIncludeAction")
              : t("workspace.excludedFolderRemoveAction")}
          </>
        )}
      </Button>
    </li>
  );
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}
