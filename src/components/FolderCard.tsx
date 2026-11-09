// A child folder in the folder view, drawn as a folder: a tab over a tinted
// body that holds a mosaic of what is inside, then the folder's name, how much
// it holds and how many folders it contains.
//
// However it looks, it measures exactly like MediaGrid's media card — a 1px
// frame, an aspect-video top, a 1px rule and a metadata block of the same
// fixed height — because the grid sizes every row from one measured row, and a
// folder card a pixel off would put every row after a mixed one out of place.
// So the tab and body are drawn inside the aspect-video box, and the edges
// below it are inset shadows, which take no room.
import { Folder } from "lucide-react";
import { memo, type MouseEvent } from "react";
import { FolderArt } from "@/components/FolderArt";
import {
  isSelectionClick,
  useFolderSelection,
} from "@/components/SelectionContext";
import { FolderSelectionCheck } from "@/components/SelectionCheck";
import type { FolderEntry } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface Props {
  entry: FolderEntry;
  mediaBase: string;
  focused?: boolean;
  onOpen: (path: string) => void;
}

// Keeps the second line's height when there is nothing to say on it.
const NBSP = String.fromCharCode(0xa0);

// The body's side and bottom edges below the top box, drawn without taking
// room (see the file comment).
const META_EDGE =
  "shadow-[inset_1px_0_0_var(--folder-edge),inset_-1px_0_0_var(--folder-edge),inset_0_-1px_0_var(--folder-edge)]";

export const FolderCard = memo(function FolderCard({
  entry,
  mediaBase,
  focused,
  onOpen,
}: Props) {
  const { t } = useI18n();
  const { active, selected, toggle } = useFolderSelection(entry.path);
  const count = t("folder.itemCount", { count: entry.count });
  // Same rule as a media card: while selecting every click picks, otherwise a
  // modified click does (and starts selecting). Shift has no range to draw
  // across folders, so it toggles like Ctrl.
  const open = (e: MouseEvent) => {
    if (isSelectionClick(active, e)) {
      e.preventDefault();
      toggle(entry);
      return;
    }
    onOpen(entry.path);
  };
  return (
    <div
      data-testid="folder-card"
      data-slot="folder-card"
      aria-current={focused ? "true" : undefined}
      className={cn(
        "folder-art group relative flex flex-col rounded-lg border border-transparent",
        // The media card's state vocabulary, so a mixed row reads as one list.
        focused && "ring-2 ring-primary",
        selected && "ring-1 ring-primary",
      )}
    >
      {/* The folder body opens the folder too; the name button below is the
          keyboard/screen-reader target, so this region stays out of the tab order. */}
      <div
        data-thumb
        onClick={open}
        className="group/thumb relative block aspect-video cursor-pointer"
      >
        <FolderArt previews={entry.previews} mediaBase={mediaBase} joined />
      </div>
      <FolderSelectionCheck
        entry={entry}
        className="absolute left-2.5 top-[calc(var(--folder-tab-h)+10px)] z-10"
      />
      {/* Same block as the media card's metadata: a 1px rule, the name line,
          a second line, then empty slots the height of its rating and tag rows. */}
      <div
        className={cn(
          "flex flex-col gap-1 rounded-b-lg border-t border-(--folder-tint) bg-(--folder-tint) px-2 py-1.5 transition-colors group-hover:border-(--folder-tint-hover) group-hover:bg-(--folder-tint-hover)",
          META_EDGE,
        )}
      >
        {/* 16px tall like the media card's text-xs name line: the name and the
            pill are leading-4 and the icon is shorter. */}
        <div className="flex items-center gap-1.5">
          <Folder
            aria-hidden
            className="size-3.5 shrink-0 fill-accent2 text-accent2"
          />
          <button
            type="button"
            onClick={open}
            aria-label={t("folder.open", { name: entry.name })}
            title={entry.name}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-bold leading-4 text-bright-fg"
          >
            {entry.name}
          </button>
          <span className="shrink-0 rounded-full bg-bg/55 px-1.5 text-[10px] font-semibold leading-4 text-bright-fg">
            {count}
          </span>
        </div>
        <div className="truncate text-[10px] text-fg">
          {entry.subfolders > 0
            ? t("folder.subfolders", { count: entry.subfolders })
            : NBSP}
        </div>
        <div aria-hidden className="h-[14px]" />
        <div aria-hidden className="h-6" />
      </div>
    </div>
  );
});
