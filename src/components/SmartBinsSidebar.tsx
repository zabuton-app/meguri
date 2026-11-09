import { useState } from "react";
import {
  Bookmark,
  Folder,
  Globe,
  Library,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { LibraryScope } from "@/hooks/useLibraryLocation";
import type { SearchQuery, WorkspaceInfo } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import {
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
  activeId,
  scopeMode,
  onScopeChange,
  localAvailable = false,
  locationLabel,
  onBrowse,
}: {
  query: SearchQuery;
  workspaceId: string | null;
  workspaces: WorkspaceInfo[];
  onApply: (collection: SmartCollection) => void;
  activeId?: string;
  scopeMode?: LibraryScope | null;
  onScopeChange?: (scope: LibraryScope) => void;
  localAvailable?: boolean;
  locationLabel?: string;
  onBrowse?: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const smart = useSmartCollections();
  // null creates a bin, an existing collection edits one, undefined is closed.
  const [editing, setEditing] = useState<SmartCollection | null>();
  return (
    <aside
      aria-label={t("smartBin.title")}
      className="absolute inset-y-0 left-0 hidden h-full w-56 shrink-0 flex-col border-r border-border bg-surface sm:flex"
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="min-w-0 break-words text-xs font-semibold">
          {t("smartBin.title")}
        </h2>
        {onScopeChange && (
          <div
            role="group"
            aria-label={t("smartBin.location")}
            className="ml-auto flex shrink-0 overflow-hidden rounded border border-border text-[10px]"
          >
            {(["global", "local"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={scopeMode === mode}
                disabled={mode === "local" && !localAvailable}
                title={
                  mode === "local" && !localAvailable
                    ? t("smartBin.noLocal")
                    : t(`smartBin.${mode}Hint`)
                }
                onClick={() => onScopeChange(mode)}
                className={cn(
                  "px-1.5 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  scopeMode === mode
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted hover:bg-overlay hover:text-fg",
                )}
              >
                {t(`smartBin.${mode}`)}
              </button>
            ))}
          </div>
        )}
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
      {locationLabel && (
        <div
          data-slot="library-location"
          className="flex items-start gap-1.5 border-b border-border px-3 pb-3 text-xs text-muted"
        >
          {scopeMode === "global" ? (
            <Globe className="mt-0.5 size-3 shrink-0" />
          ) : (
            <Folder className="mt-0.5 size-3 shrink-0" />
          )}
          <span className="min-w-0 break-words" title={locationLabel}>
            {locationLabel}
          </span>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {onBrowse && (
            <button
              type="button"
              onClick={onBrowse}
              aria-label={t("smartBin.browse")}
              aria-current={!activeId ? "true" : undefined}
              className={cn(
                "mb-2 flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-2 text-left text-sm",
                !activeId
                  ? "border-primary bg-primary/20 font-semibold text-fg"
                  : "border-transparent text-muted hover:bg-overlay",
              )}
            >
              <Library className="size-4 shrink-0" />
              <span>{t("smartCollection.allMedia")}</span>
            </button>
          )}
          {smart.collections.length === 0 && (
            <p className="px-1 py-3 text-xs text-muted">
              {t("smartBin.empty")}
            </p>
          )}
          {smart.collections.map((collection) => {
            const active = collection.id === activeId;
            const scope =
              locationLabel ??
              (collection.scope === "all"
                ? t("smartBin.all")
                : collection.workspaceId
                  ? (workspaces.find((w) => w.id === collection.workspaceId)
                      ?.label ?? t("folder.workspaceGone"))
                  : t("smartBin.current"));
            return (
              <div
                key={collection.id}
                className={cn(
                  "group rounded-md border-l-2",
                  active
                    ? "border-primary bg-primary/20"
                    : "border-transparent",
                )}
              >
                <button
                  type="button"
                  onClick={() => onApply(collection)}
                  aria-current={active ? "true" : undefined}
                  title={`${scope}\n${describeSearchQuery(t, collection.query)}`}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-overlay"
                >
                  <Bookmark
                    className={cn(
                      "mt-0.5 size-4 shrink-0 text-primary",
                      active && "fill-primary/25",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {collection.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      {onScopeChange
                        ? describeSearchQuery(t, collection.query)
                        : scope}
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
          portable={!!onScopeChange}
          onSave={(collection) => {
            let saved = collection;
            if (editing) smart.updateCollection(collection);
            else
              saved = smart.addCollection(
                collection.name,
                collection.query,
                collection.workspaceId,
                collection.scope,
              );
            if (!editing || editing.id === activeId) onApply(saved);
          }}
        />
      )}
    </aside>
  );
}
