// A folder drawn as a folder — a tab over a tinted body holding a mosaic of
// what is inside — shared by the grid's folder card and the list's folder row.
import { Folder } from "lucide-react";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";

/**
 * The folder itself: a tab over a tinted body holding the mosaic, drawn to
 * fill a positioned box of the caller's (a card's aspect-video top, a list
 * row's thumbnail slot). Hovering the nearest `group` lifts the tint. Needs
 * the `.folder-art` variables (src/styles.css) on an ancestor.
 *
 * `joined`: the body runs on below the box (the card's metadata continues
 * it), so it has no bottom edge; otherwise it closes with one.
 */
export function FolderArt({
  previews,
  mediaBase,
  joined = false,
}: {
  previews: FileRow[];
  mediaBase: string;
  joined?: boolean;
}) {
  return (
    <>
      {/* Starts 1px above the tab's bottom so the tab, drawn after it, covers
          the stretch of its top edge under the tab: the two read as one
          outline with no rule between them. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 top-[calc(var(--folder-tab-h)-1px)] rounded-tr-lg border border-(--folder-edge) bg-(--folder-tint) transition-colors group-hover:bg-(--folder-tint-hover)",
          joined ? "border-b-0" : "rounded-b-lg",
        )}
      >
        <div
          className={cn(
            "absolute inset-x-1.5 top-1.5 overflow-hidden rounded-[5px] bg-bg/45 text-accent2",
            joined ? "bottom-0" : "bottom-1.5",
          )}
        >
          <Mosaic previews={previews} mediaBase={mediaBase} />
        </div>
      </div>
      <div
        aria-hidden
        className="absolute left-0 top-0 h-(--folder-tab-h) w-[42%] rounded-t-md border border-b-0 border-(--folder-edge) bg-(--folder-tint) transition-colors group-hover:bg-(--folder-tint-hover)"
      />
    </>
  );
}

// Tiles by how many files the folder offered: one fills the frame, two sit
// side by side, three put one tall tile beside two, four make a 2×2.
const LAYOUT: Record<number, { grid: string; first?: string }> = {
  1: { grid: "grid-cols-1 grid-rows-1" },
  2: { grid: "grid-cols-2 grid-rows-1" },
  3: { grid: "grid-cols-2 grid-rows-2", first: "row-span-2" },
  4: { grid: "grid-cols-2 grid-rows-2" },
};

function Mosaic({
  previews,
  mediaBase,
}: {
  previews: FileRow[];
  mediaBase: string;
}) {
  const layout = LAYOUT[previews.length];
  if (!layout) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Folder className="size-10 fill-current opacity-70" />
      </div>
    );
  }
  return (
    <div
      data-testid="folder-mosaic"
      className={cn("absolute inset-0 grid gap-[3px]", layout.grid)}
    >
      {previews.map((file, i) => (
        <div
          key={`${file.workspaceId}:${file.id}`}
          className={cn(
            "relative overflow-hidden rounded-[3px] bg-overlay text-muted",
            i === 0 && layout.first,
          )}
        >
          <MediaThumbnail
            file={file}
            mediaBase={mediaBase}
            fallbackIconSize="size-5"
            showPlayOverlay={false}
            scrubPreview={false}
            showProgress={false}
          />
        </div>
      ))}
    </div>
  );
}
