// A child folder in the list shown by folder: the folder drawn in the
// thumbnail slot (FolderArt, the same as a folder card's), then its name and
// what it holds.
//
// Laid out like MediaList's media row — the same padding, the same thumbnail
// slot and a text block of the same three line heights — because the list
// sizes every row from one measured row.
import { ChevronRight, Folder } from "lucide-react";
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

export const FolderRow = memo(function FolderRow({
  entry,
  mediaBase,
  thumbWidth,
  focused,
  onOpen,
}: {
  entry: FolderEntry;
  mediaBase: string;
  /** Tailwind width class for the thumbnail slot (the list's thumbnail size). */
  thumbWidth: string;
  focused?: boolean;
  onOpen: (path: string) => void;
}) {
  const { t } = useI18n();
  const { active, selected, toggle } = useFolderSelection(entry.path);
  const count = t("folder.itemCount", { count: entry.count });
  // Same rule as a folder card: while selecting every click picks, otherwise
  // a modified click does (and starts selecting).
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
      data-testid="folder-row"
      data-slot="folder-row"
      aria-current={focused ? "true" : undefined}
      className={cn(
        "folder-art group relative flex items-center gap-4 rounded-lg p-2 pr-4 transition-colors hover:bg-overlay/50",
        // The media row's state vocabulary, so the two read as one list.
        selected && "bg-primary/10 ring-1 ring-inset ring-primary/50",
        focused && "bg-primary/15 ring-2 ring-inset ring-primary",
      )}
    >
      {/* Above the name's stretched hit area, like a media row's thumbnail;
          it opens the folder too. */}
      <div
        onClick={open}
        className={cn(
          "relative z-10 aspect-video shrink-0 cursor-pointer",
          thumbWidth,
        )}
      >
        <FolderArt previews={entry.previews} mediaBase={mediaBase} />
        <FolderSelectionCheck
          entry={entry}
          className="absolute left-1.5 top-[calc(var(--folder-tab-h)+4px)] z-10"
        />
      </div>

      {/* The media row's three lines: name (h-6), a second line (h-4) and
          the tag line (h-5), here left empty. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex h-6 min-w-0 items-center gap-1.5">
          <Folder
            aria-hidden
            className="size-4 shrink-0 fill-accent2 text-accent2"
          />
          <button
            type="button"
            onClick={open}
            aria-label={t("folder.open", { name: entry.name })}
            title={entry.name}
            className="min-w-0 truncate text-left text-[15px] font-bold leading-6 text-bright-fg outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
          >
            {entry.name}
          </button>
        </div>
        <div className="flex h-4 min-w-0 items-center text-xs text-muted">
          {entry.subfolders > 0 && (
            <span className="truncate">
              {t("folder.subfolders", { count: entry.subfolders })}
            </span>
          )}
        </div>
        <div aria-hidden className="h-5" />
      </div>

      <div className="pointer-events-none flex shrink-0 items-center gap-3 text-muted">
        <span className="rounded-full bg-(--folder-tint) px-2 text-xs font-semibold leading-5 text-bright-fg">
          {count}
        </span>
        <ChevronRight aria-hidden className="size-4" />
      </div>
    </div>
  );
});
