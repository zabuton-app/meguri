// The folder view's location, as a header: the folder shown, large and marked
// with the folder colour, the path above it as a line of links back up, and
// on the right what the folder holds and ways to reach it outside the app:
// open it in the OS file manager, or copy its path. A deep path keeps the root and the
// nearest level and folds the middle into a menu, so the line never wraps and
// every level stays one click away. The folder shown opens a menu of its own
// child folders, so the header reaches down as well as up.
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/ipc/client";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import { ROOT_FOLDER, splitFolderPath } from "@shared/folderPath";

/** How long a folder listing serves the subfolder menu without a refetch. */
const SUBFOLDER_STALE_MS = 30_000;

/** Levels above the current one shown before the middle folds away. */
const MAX_ANCESTORS = 3;

interface Level {
  label: string;
  path: string;
}

export function FolderHeader({
  workspaceId,
  rootLabel,
  path,
  onNavigate,
  canGoBack,
  onBack,
  onUp,
  summary,
  onOpenInFileManager,
  onCopyPath,
  sourceAction,
}: {
  /** The workspace browsed; without it the folder shown has no subfolder menu. */
  workspaceId?: string;
  /** What the workspace root is called (the workspace's display name). */
  rootLabel: string;
  path: string;
  onNavigate: (path: string) => void;
  canGoBack: boolean;
  onBack: () => void;
  onUp: () => void;
  /** What the folder holds ("7 folders · 8 files"); omitted while unknown. */
  summary?: string;
  /** Opens the folder shown in the OS file manager. */
  onOpenInFileManager: () => void;
  /** Copies the folder's absolute path to the clipboard. */
  onCopyPath: () => void;
  sourceAction?: ReactNode;
}) {
  const { t } = useI18n();
  const segments = splitFolderPath(path);
  const levels: Level[] = [
    { label: rootLabel, path: ROOT_FOLDER },
    ...segments.map((label, i) => ({
      label,
      path: segments.slice(0, i + 1).join("/"),
    })),
  ];
  const current = levels[levels.length - 1];
  const ancestors = levels.slice(0, -1);
  const folded = ancestors.length > MAX_ANCESTORS ? ancestors.slice(1, -1) : [];
  const shown =
    folded.length > 0
      ? [ancestors[0], ancestors[ancestors.length - 1]]
      : ancestors;

  return (
    <nav
      aria-label={t("folder.breadcrumbLabel")}
      className="flex h-14 min-w-0 items-center gap-3 border-b border-border bg-bg px-4"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <NavButton
          label={t("folder.back")}
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </NavButton>
        <NavButton
          label={t("folder.up")}
          disabled={path === ROOT_FOLDER}
          onClick={onUp}
        >
          <ArrowUp className="size-4" />
        </NavButton>
      </div>
      <Folder
        aria-hidden
        className="size-5 shrink-0 fill-accent2 text-accent2"
      />
      <div className="flex min-w-0 flex-col">
        {shown.length > 0 && (
          <div className="flex min-w-0 items-center gap-0.5 text-[11px] text-muted">
            {shown.map((level, i) => (
              <Fragment key={level.path}>
                {i === 1 && folded.length > 0 && (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={t("folder.more")}
                        title={t("folder.more")}
                        className="flex h-4 items-center rounded px-0.5 transition hover:bg-fg/10 hover:text-fg"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {folded.map((f) => (
                          <DropdownMenuItem
                            key={f.path}
                            onSelect={() => onNavigate(f.path)}
                          >
                            {f.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Separator />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate(level.path)}
                  title={level.label}
                  className="h-4 min-w-0 max-w-48 shrink truncate rounded leading-4 transition hover:text-fg hover:underline"
                >
                  {level.label}
                </button>
                <Separator />
              </Fragment>
            ))}
          </div>
        )}
        {workspaceId ? (
          <DropdownMenu>
            {/* The current level, as the menu's trigger: the button carries
                aria-current, since its label replaces what is inside it. */}
            <DropdownMenuTrigger
              aria-current="page"
              aria-label={t("folder.subfolderMenu", { name: current.label })}
              title={t("folder.subfolderMenu", { name: current.label })}
              className="-mx-1 flex min-w-0 items-center gap-1 rounded px-1 transition hover:bg-fg/10"
            >
              <CurrentLabel label={current.label} marked={false} />
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
            </DropdownMenuTrigger>
            {/* Capped by max-height, not sized: the scroll area is a flex
                column so its viewport can shrink as a flex item (the same
                shape as ShortcutsOverlay), with the app's own scrollbar. */}
            <DropdownMenuContent
              align="start"
              className="flex max-h-80 flex-col p-0"
            >
              <ScrollArea
                className="flex min-h-0 flex-1 flex-col"
                viewportClassName="min-h-0 flex-1 p-1"
              >
                <SubfolderItems
                  workspaceId={workspaceId}
                  path={path}
                  onNavigate={onNavigate}
                  t={t}
                />
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <CurrentLabel label={current.label} />
        )}
      </div>
      <div className="flex-1" />
      {summary && (
        <span className="shrink-0 text-xs text-muted">{summary}</span>
      )}
      {/* Same group styling as the header's Scan button. */}
      {sourceAction}
      <ButtonGroup className="shrink-0 [&>button]:border [&>button]:border-muted/35 [&>button]:bg-surface [&>button:not(:first-child)]:relative [&>button:not(:first-child)]:z-[1]">
        <Button
          size="sm"
          variant="outline"
          className="border border-muted/35 bg-surface"
          onClick={onOpenInFileManager}
        >
          <FolderOpen aria-hidden />
          {t("folder.openInFileManager")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border border-muted/35 bg-surface"
          onClick={onCopyPath}
        >
          <Copy aria-hidden />
          {t("folder.copyPath")}
        </Button>
      </ButtonGroup>
    </nav>
  );
}

function CurrentLabel({
  label,
  marked = true,
}: {
  label: string;
  /** Whether the label itself is marked as the current level. */
  marked?: boolean;
}) {
  return (
    <span
      aria-current={marked ? "page" : undefined}
      title={label}
      className="truncate text-base font-bold leading-5 text-bright-fg"
    >
      {label}
    </span>
  );
}

/**
 * The folder's child folders, read when the menu opens. Same query as the
 * folder view's own listing, so while browsing it is served from the cache;
 * while searching (when the view skips the listing) it is fetched here.
 */
function SubfolderItems({
  workspaceId,
  path,
  onNavigate,
  t,
}: {
  workspaceId: string;
  path: string;
  onNavigate: (path: string) => void;
  t: TFunc;
}) {
  const listing = useQuery({
    queryKey: ["folders_list", workspaceId, path],
    queryFn: () => api.foldersList(workspaceId, path),
    // Opening the menu right after the view listed the folder costs no second
    // listing; later, the cached one is shown at once and refreshed behind it.
    staleTime: SUBFOLDER_STALE_MS,
  });
  if (listing.isPending) {
    return <DropdownMenuItem disabled>{t("folder.loading")}</DropdownMenuItem>;
  }
  if (listing.isError) {
    return (
      <DropdownMenuItem disabled>
        {t("folder.subfoldersFailed")}
      </DropdownMenuItem>
    );
  }
  // A folder that is gone is answered with an ancestor: its children are not
  // this folder's, and the view is about to move there anyway.
  const folders =
    listing.data?.path === path ? listing.data.folders : undefined;
  if (!folders?.length) {
    return (
      <DropdownMenuItem disabled>{t("folder.noSubfolders")}</DropdownMenuItem>
    );
  }
  return folders.map((f) => (
    <DropdownMenuItem key={f.path} onSelect={() => onNavigate(f.path)}>
      <Folder aria-hidden className="fill-accent2 text-accent2" />
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      <span className="shrink-0 text-xs text-muted">{f.count}</span>
    </DropdownMenuItem>
  ));
}

function Separator() {
  return <ChevronRight aria-hidden className="size-3 shrink-0 text-muted/70" />;
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg transition hover:bg-fg/10 disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
