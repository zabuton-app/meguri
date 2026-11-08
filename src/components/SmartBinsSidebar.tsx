import { useState } from "react";
import { Bookmark, Pencil, Plus, Trash2 } from "lucide-react";
import type { SearchQuery, WorkspaceInfo } from "@/ipc/types";
import { ALL_ID } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import {
  cleanSearchQuery,
  describeSearchQuery,
  type SmartCollection,
} from "@/lib/smartCollections";
import { SmartBinDialog } from "./SmartBinDialog";
import { ScrollArea } from "./ui/scroll-area";
import { useConfirm } from "./ConfirmDialog";
import { cn } from "@/lib/utils";

export function SmartBinsSidebar({
  query,
  workspaceId,
  workspaces,
  onApply,
}: {
  query: SearchQuery;
  workspaceId: string | null;
  workspaces: WorkspaceInfo[];
  onApply: (collection: SmartCollection) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const smart = useSmartCollections();
  // null creates a bin, an existing collection edits one, undefined is closed.
  const [editing, setEditing] = useState<SmartCollection | null>();
  const currentQuery = JSON.stringify(cleanSearchQuery(query));
  return (
    <aside
      aria-label={t("smartBin.title")}
      className="absolute inset-y-0 left-0 hidden h-full w-52 shrink-0 flex-col border-r border-border bg-surface sm:flex"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <h2 className="text-sm font-semibold">{t("smartBin.title")}</h2>
        <button
          type="button"
          title={t("smartBin.create")}
          aria-label={t("smartBin.create")}
          className="rounded p-1 text-muted hover:bg-overlay hover:text-fg"
          onClick={() => setEditing(null)}
        >
          <Plus className="size-4" />
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {smart.collections.length === 0 && (
            <p className="px-1 py-3 text-xs text-muted">
              {t("smartBin.empty")}
            </p>
          )}
          {smart.collections.map((collection) => {
            const scopeMatches =
              collection.scope === "all"
                ? workspaceId === ALL_ID
                : !collection.workspaceId ||
                  workspaceId === collection.workspaceId;
            const active =
              scopeMatches &&
              currentQuery ===
                JSON.stringify(cleanSearchQuery(collection.query));
            const scope =
              collection.scope === "all"
                ? t("smartBin.all")
                : collection.workspaceId
                  ? (workspaces.find((w) => w.id === collection.workspaceId)
                      ?.label ?? t("folder.workspaceGone"))
                  : t("smartBin.current");
            return (
              <div
                key={collection.id}
                className={cn("group rounded-md", active && "bg-primary/15")}
              >
                <button
                  type="button"
                  onClick={() => onApply(collection)}
                  aria-current={active ? "true" : undefined}
                  title={`${scope}\n${describeSearchQuery(t, collection.query)}`}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-overlay"
                >
                  <Bookmark className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {collection.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      {scope}
                    </span>
                  </span>
                </button>
                <div className="flex justify-end gap-1 px-1 pb-1">
                  <button
                    type="button"
                    aria-label={`${t("smartBin.edit")}: ${collection.name}`}
                    className="rounded p-1 text-muted hover:bg-overlay hover:text-fg"
                    onClick={() => setEditing(collection)}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("smartBin.delete")}: ${collection.name}`}
                    className="rounded p-1 text-muted hover:bg-overlay hover:text-destructive"
                    onClick={() =>
                      void (async () => {
                        if (
                          await confirm({
                            title: t("smartBin.delete"),
                            message: t("smartBin.deleteConfirm", {
                              name: collection.name,
                            }),
                            confirmText: t("smartBin.delete"),
                            destructive: true,
                          })
                        )
                          smart.removeCollection(collection.id);
                      })()
                    }
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      {editing !== undefined && (
        <SmartBinDialog
          collection={editing}
          query={query}
          workspaceId={workspaceId}
          workspaces={workspaces}
          onClose={() => setEditing(undefined)}
          onSave={(collection) => {
            if (editing) smart.updateCollection(collection);
            else
              smart.addCollection(
                collection.name,
                collection.query,
                collection.workspaceId,
                collection.scope,
              );
            onApply(collection);
          }}
        />
      )}
    </aside>
  );
}
