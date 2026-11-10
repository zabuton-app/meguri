// The right-click menu on the files of a list view (grid, list, timeline).
//
// One menu per view, not one per card: the view's cards are virtualized and
// memoized, and a menu root on each would add to every card's mount for a menu
// that is open on one card at a time. The trigger wraps the whole view and
// finds the card from the event (its `data-file-key`); the menu's contents,
// and the hooks they need, mount only while it is open.
//
// What it acts on follows the command menu: the selection when the clicked
// card is part of it, otherwise that one file. The actions come from
// useFileActions, which the command menu shares.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  CircleCheck,
  Clock,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Heart,
  ImageDown,
  Info,
  Play,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSelection } from "@/components/SelectionContext";
import { useActivateFile } from "@/audio/useActivateFile";
import { getFocusedFile } from "@/hooks/useFocusedFile";
import {
  useCollectionMembership,
  useFileActions,
  type FileActions,
} from "@/hooks/useFileActions";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import { mediaSortId } from "@/lib/mediaSortId";
import { folderPathOf } from "@/lib/relPath";
import { showFolderInLibrary } from "@/lib/ui-events";
import { copyImageToClipboard } from "@/routes/MediaDetail/utils";
import { usePreferences } from "@/settings/PreferencesProvider";
import {
  formatChords,
  GRID_BINDINGS,
  isContextMenuKey,
} from "@/settings/keybindings";
import { isNormalizedFolderPath } from "@shared/folderPath";
import { MAX_BULK_FILES } from "@shared/tags";

/** The attribute a file's card or row carries, so the menu can tell which was clicked. */
const FILE_KEY_ATTR = "data-file-key";

const NO_FILES: FileRow[] = [];
const RATINGS = [0, 1, 2, 3, 4, 5];

const isTyping = (el: Element | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

function cardOf(target: EventTarget | null): Element | null {
  return target instanceof Element
    ? target.closest(`[${FILE_KEY_ATTR}]`)
    : null;
}

export function FileContextMenu({
  items,
  mediaBase,
  active,
  children,
}: {
  /** The files the view shows; a right-clicked card is looked up among them. */
  items: FileRow[];
  /** Base URL of the local media server, for copying an image. */
  mediaBase: string;
  /** The view is in the foreground: the menu key opens the menu on the focused file. */
  active: boolean;
  children: ReactNode;
}) {
  const [file, setFile] = useState<FileRow | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isContextMenuKey(e) || isTyping(document.activeElement)) return;
      const focused = getFocusedFile();
      if (!focused) return;
      const key = mediaSortId(focused);
      const card = Array.from(
        rootRef.current?.querySelectorAll(`[${FILE_KEY_ATTR}]`) ?? [],
      ).find((el) => el.getAttribute(FILE_KEY_ATTR) === key);
      if (!card) return;
      e.preventDefault();
      // There is no pointer to open at: open under the focused card's corner.
      // The menu opens only from a contextmenu event on its trigger, so send
      // one from the card, as a right-click there would.
      const rect = card.getBoundingClientRect();
      card.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 16,
          clientY: rect.bottom,
        }),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) setFile(null);
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={rootRef}
          className="contents"
          onContextMenu={(e) => {
            const key = cardOf(e.target)?.getAttribute(FILE_KEY_ATTR);
            const hit = key ? items.find((f) => mediaSortId(f) === key) : null;
            // Not on a file (a folder card, the gaps between cards): no menu.
            if (!hit) {
              e.preventDefault();
              return;
            }
            setFile(hit);
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      {file && (
        <ContextMenuContent
          className="min-w-56"
          // The menu's keys are its own: the views' window listeners (focus
          // movement, "W", Esc leaving selection mode) must not act on them.
          onKeyDown={(e) => e.stopPropagation()}
          onEscapeKeyDown={stopEscape}
        >
          <FileMenuBody file={file} mediaBase={mediaBase} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

function FileMenuBody({
  file,
  mediaBase,
}: {
  file: FileRow;
  mediaBase: string;
}) {
  const { t } = useI18n();
  const selection = useSelection();
  const watchLater = useWatchLater();
  const { activate } = useActivateFile();
  const { keybindingPreset } = usePreferences();
  const keys = GRID_BINDINGS[keybindingPreset];

  const inSelection = selection.active && selection.isSelected(file);
  // As in the command menu: no bulk edit while a picked folder's files are
  // still coming in, nor past the cap.
  const blocked =
    inSelection && (selection.pending || selection.count > MAX_BULK_FILES);
  const targets = useMemo(
    () => (!inSelection ? [file] : blocked ? NO_FILES : selection.rows),
    [inSelection, blocked, file, selection.rows],
  );
  const files = useFileActions(targets, watchLater);
  const single = inSelection ? null : files.single;
  const disabled = targets.length === 0;

  const folderPath = folderPathOf(file.relPath);
  const imageSrc =
    file.kind === "image" && mediaBase
      ? `${mediaBase}/ws/${file.workspaceId}/media/${file.id}`
      : "";

  return (
    <>
      {inSelection && (
        <>
          <ContextMenuLabel data-testid="file-menu-count">
            <CircleCheck className="text-primary" />
            {t("command.selectedFiles", { count: selection.count })}
          </ContextMenuLabel>
          {blocked && !selection.pending && (
            <ContextMenuLabel>
              {t("select.bulkFileLimit", { max: MAX_BULK_FILES })}
            </ContextMenuLabel>
          )}
          <ContextMenuSeparator />
        </>
      )}
      {single && (
        <>
          <ContextMenuItem onSelect={() => activate(file)}>
            <Play />
            <span className="flex-1">{t("fileMenu.open")}</span>
            <Shortcut>{formatChords(keys.open)}</Shortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => activate(file, { autoplay: false })}>
            <Info />
            <span className="flex-1">{t("fileMenu.inspect")}</span>
            <Shortcut>{formatChords(keys.inspect)}</Shortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={single.openExternal}>
            <ExternalLink />
            {t("media.openExternal")}
          </ContextMenuItem>
          {imageSrc && (
            <ContextMenuItem onSelect={() => copyImage(imageSrc, t)}>
              <ImageDown />
              {t("media.copyImage")}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem disabled={disabled} onSelect={files.toggleFavorite}>
        <Heart />
        {files.favorite === "all" ? t("favorite.remove") : t("favorite.add")}
        {files.favorite === "some" && <SomeBadge t={t} />}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={disabled || !files.toggleWatchLater}
        onSelect={() => files.toggleWatchLater?.()}
      >
        <Clock />
        <span className="flex-1">
          {files.watchLater === "all"
            ? t("watchLater.remove")
            : t("watchLater.add")}
        </span>
        {files.watchLater === "some" && <SomeBadge t={t} />}
        {/* The "W" key acts on the focused card, not on a selection. */}
        {single && <Shortcut>W</Shortcut>}
      </ContextMenuItem>
      <RatingSub t={t} files={files} disabled={disabled} />
      <CollectionsSub
        t={t}
        targets={targets}
        files={files}
        disabled={disabled}
      />
      {single && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={single.openFolder}>
            <FolderOpen />
            {t("media.openFolder")}
          </ContextMenuItem>
          {isNormalizedFolderPath(folderPath) && (
            <ContextMenuItem
              onSelect={() =>
                showFolderInLibrary({
                  workspaceId: file.workspaceId,
                  path: folderPath,
                })
              }
            >
              <FolderSearch />
              {t("folder.showInLibrary")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={single.copyPath}>
            <Copy />
            {t("media.copyFilePath")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-error data-[highlighted]:text-error"
            // After the menu has closed and handed focus back, so the
            // confirmation keeps it (as the command menu's closeThen does).
            onSelect={() =>
              window.setTimeout(() => void single.deleteFromIndex(), 0)
            }
          >
            <Trash2 />
            {t("media.deleteFromIndex")}
          </ContextMenuItem>
        </>
      )}
      {inSelection && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={selection.exit}>
            <X />
            <span className="flex-1">{t("select.exit")}</span>
            <Shortcut>Esc</Shortcut>
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

/**
 * Esc is the menu's too, but it is handled on the document before it reaches
 * the menu, and the menu is gone by the time it would bubble through it: stop
 * it there, or it goes on to leave selection mode (SelectionLayer).
 */
function stopEscape(e: KeyboardEvent) {
  e.stopPropagation();
}

function copyImage(src: string, t: TFunc) {
  copyImageToClipboard(src).then(
    () => toast.success(t("media.imageCopied")),
    (e: unknown) => {
      console.error("copy image failed:", e);
      toast.error(t("media.imageCopyFailed"));
    },
  );
}

function Shortcut({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto pl-4 font-mono text-[11px] text-muted">
      {children}
    </span>
  );
}

function SomeBadge({ t }: { t: TFunc }) {
  return (
    <span className="ml-auto rounded-full border border-border-strong px-1.5 text-[10px] leading-4 text-fg">
      {t("fileMenu.some")}
    </span>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-xs tracking-wider text-warn" aria-hidden>
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

function RatingSub({
  t,
  files,
  disabled,
}: {
  t: TFunc;
  files: FileActions;
  disabled: boolean;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <Star />
        <span className="flex-1">{t("command.pageRating")}</span>
        {files.rating == null ? (
          <span className="text-xs text-muted">{t("command.ratingMixed")}</span>
        ) : (
          <Stars rating={files.rating} />
        )}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        onEscapeKeyDown={stopEscape}
        className="min-w-44"
        onKeyDown={(e) => {
          e.stopPropagation();
          // A digit picks the rating outright, as in the command menu: press
          // the row, so the menu closes the way a click would close it.
          if (/^[0-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.currentTarget
              .querySelector<HTMLElement>(`[data-rating="${e.key}"]`)
              ?.click();
          }
        }}
      >
        {files.rating == null && (
          <ContextMenuLabel>{t("select.ratingMixed")}</ContextMenuLabel>
        )}
        {RATINGS.map((n) => (
          <ContextMenuItem
            key={n}
            data-rating={n}
            onSelect={() => files.setRating(n)}
          >
            {files.rating === n ? (
              <Check className="text-primary" />
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            )}
            <span className="flex-1">
              {n === 0 ? (
                t("command.ratingNone")
              ) : (
                <>
                  <span className="sr-only">
                    {t("command.ratingStars", { rating: n })}
                  </span>
                  <Stars rating={n} />
                </>
              )}
            </span>
            <Shortcut>{n}</Shortcut>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function CollectionsSub({
  t,
  targets,
  files,
  disabled,
}: {
  t: TFunc;
  targets: FileRow[];
  files: FileActions;
  disabled: boolean;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <FolderPlus />
        <span className="flex-1">{t("command.pageCollections")}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        onEscapeKeyDown={stopEscape}
        className="max-h-80 min-w-44 overflow-y-auto"
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Mounted only while the submenu is open: reading membership scans
            every collection's items (see useCollectionMembership). */}
        <CollectionItems t={t} targets={targets} files={files} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function CollectionItems({
  t,
  targets,
  files,
}: {
  t: TFunc;
  targets: FileRow[];
  files: FileActions;
}) {
  const collections = useCollectionMembership(targets);
  if (collections.length === 0) {
    return <ContextMenuItem disabled>{t("collection.empty")}</ContextMenuItem>;
  }
  return collections.map((c) => (
    <ContextMenuItem key={c.id} onSelect={() => files.toggleCollection(c)}>
      {c.included === "all" ? (
        <Check className="text-primary" />
      ) : c.emoji ? (
        <span className="w-4 shrink-0 text-center" aria-hidden>
          {c.emoji}
        </span>
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <span className="flex-1 truncate">{c.name}</span>
      {c.included === "some" && <SomeBadge t={t} />}
    </ContextMenuItem>
  ));
}
