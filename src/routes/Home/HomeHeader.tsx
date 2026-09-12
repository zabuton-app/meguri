import {
  ChevronDown,
  CopyCheck,
  DatabaseBackup,
  FolderOpen,
  History,
  LayoutGrid,
  List,
  Pencil,
  RefreshCw,
  Table2,
  Tags as TagsIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { UserCollection, WorkspaceInfo } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import type { TFunc } from "@/i18n/I18nProvider";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import type { ViewMode } from "./utils";

/**
 * Display name for a collection. The built-in Watch Later stores an English
 * placeholder name, so its label comes from the catalog and follows the UI
 * language like every other built-in string.
 */
function collectionLabel(collection: UserCollection, t: TFunc): string {
  return collection.id === WATCH_LATER_ID
    ? t("watchLater.name")
    : collection.name;
}

export function HomeHeader({
  root,
  rootFetched,
  collection,
  onEditCollection,
  workspace,
  onEditWorkspace,
  view,
  onSetView,
  scanning,
  ready,
  onScan,
  onScanWithDeleted,
  onRebuild,
  t,
}: {
  root: string | null | undefined;
  rootFetched: boolean;
  /** The active user collection, when one is selected (null for a normal workspace). */
  collection: UserCollection | null;
  onEditCollection: () => void;
  /** The active real workspace, when one is selected (null for a collection or "All"). */
  workspace: WorkspaceInfo | null;
  onEditWorkspace: () => void;
  view: ViewMode;
  onSetView: (v: ViewMode) => void;
  scanning: boolean;
  ready: boolean;
  onScan: () => void;
  onScanWithDeleted: () => void;
  onRebuild: () => void;
  t: TFunc;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-1.5">
      {collection ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg">
          {collection.emoji ? (
            <span className="shrink-0 leading-none">{collection.emoji}</span>
          ) : (
            <FolderOpen className="size-3.5 shrink-0" />
          )}
          <span
            className="truncate font-medium"
            title={collectionLabel(collection, t)}
          >
            {collectionLabel(collection, t)}
          </span>
          {/* Built-in collections can't be renamed or re-iconed, so no pencil.
              The main process rejects those edits anyway; offering the dialog
              here would look like it worked and then silently revert. */}
          {!collection.locked && (
            <button
              type="button"
              onClick={onEditCollection}
              aria-label={t("collection.edit")}
              title={t("collection.edit")}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-fg"
            >
              <Pencil className="size-3" />
            </button>
          )}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {workspace?.emoji ? (
            <span className="shrink-0 leading-none">{workspace.emoji}</span>
          ) : (
            <FolderOpen className="size-3.5 shrink-0" />
          )}
          <span className="truncate" title={root ?? undefined}>
            {root ?? (rootFetched ? t("home.noDirectory") : "…")}
          </span>
          {workspace && (
            <button
              type="button"
              onClick={onEditWorkspace}
              aria-label={t("workspace.edit")}
              title={t("workspace.edit")}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-fg"
            >
              <Pencil className="size-3" />
            </button>
          )}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Link
          to="/history"
          title={t("history.title")}
          aria-label={t("history.title")}
          className="flex size-7 items-center justify-center rounded-md border border-border text-muted transition hover:bg-fg/10 hover:text-fg"
        >
          <History className="size-4" />
        </Link>
        <Link
          to="/duplicates"
          title={t("duplicates.title")}
          aria-label={t("duplicates.title")}
          className="flex size-7 items-center justify-center rounded-md border border-border text-muted transition hover:bg-fg/10 hover:text-fg"
        >
          <CopyCheck className="size-4" />
        </Link>
        <Link
          to="/tags"
          title={t("tags.title")}
          aria-label={t("tags.title")}
          className="flex size-7 items-center justify-center rounded-md border border-border text-muted transition hover:bg-fg/10 hover:text-fg"
        >
          <TagsIcon className="size-4" />
        </Link>
        <div className="flex items-center rounded-md border border-border">
          {(
            [
              {
                mode: "grid",
                label: t("view.grid"),
                Icon: LayoutGrid,
                rounded: "rounded-l-md",
              },
              { mode: "list", label: t("view.list"), Icon: List, rounded: "" },
              {
                mode: "table",
                label: t("view.table"),
                Icon: Table2,
                rounded: "rounded-r-md",
              },
            ] as const
          ).map(({ mode, label, Icon, rounded }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSetView(mode)}
              aria-label={label}
              aria-pressed={view === mode}
              title={label}
              className={cn(
                "flex size-7 items-center justify-center transition",
                rounded,
                view === mode
                  ? "bg-primary/20 text-fg"
                  : "text-muted hover:bg-fg/10 hover:text-fg",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
        <ButtonGroup className="[&>button]:border [&>button]:border-muted/35 [&>button]:bg-surface [&>button:not(:first-child)]:relative [&>button:not(:first-child)]:z-[1]">
          <Button
            size="sm"
            variant="outline"
            className="border border-muted/35 bg-surface"
            onClick={onScan}
            disabled={scanning || !ready}
          >
            <RefreshCw className={scanning ? "animate-spin" : ""} />
            {t("home.scan")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border border-muted/35 bg-surface px-2"
                disabled={scanning || !ready}
                aria-label={t("home.scan")}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-56 border border-muted/35 bg-surface p-0"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="rounded-none px-3 py-2 text-xs"
                  onSelect={onScanWithDeleted}
                >
                  <RefreshCw />
                  {t("home.scanWithDeleted")}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
                <DropdownMenuItem
                  className="rounded-none px-3 py-2 text-xs"
                  onSelect={onRebuild}
                >
                  <DatabaseBackup />
                  {t("home.rebuildIndex")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
        <ThemeToggle />
      </div>
    </header>
  );
}
