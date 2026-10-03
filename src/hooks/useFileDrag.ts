// Makes a media card or row a drag source for dropping files onto a collection
// in the rail. Native HTML5 drag rather than dnd-kit: the drop targets live in
// another tree (the rail), and the browser's own drag threshold already keeps a
// plain click — open, hover preview, a heart toggle — from ever starting a drag.
import {
  useCallback,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
} from "react";
import { toast } from "sonner";
import { useReadSelection } from "@/components/SelectionContext";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import { dragPayload, encodeFileDrag, FILE_DRAG_MIME } from "@/lib/fileDrag";
import { setFileDragImage } from "@/lib/fileDragImage";
import { fileNameOf } from "@/lib/relPath";
import { MAX_BULK_FILES } from "@shared/tags";

type DragProps = Pick<HTMLAttributes<HTMLElement>, "draggable" | "onDragStart">;

const NONE: DragProps = {};

export function useFileDrag(
  file: FileRow,
  /** Whether the row is in the selection, which decides what the drag carries. */
  selected: boolean,
  /**
   * Off while the view is being reordered by hand: that drag belongs to dnd-kit
   * and a native drag starting underneath it would fight it.
   */
  enabled: boolean,
): DragProps {
  const readSelection = useReadSelection();
  const { t } = useI18n();
  const onDragStart = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      const files = dragPayload(file, readSelection(), selected);
      if (typeof files === "string") {
        // A partial drop would report success for less than was selected.
        e.preventDefault();
        toast.info(
          files === "pending"
            ? t("drag.selectionPending")
            : t("select.bulkFileLimit", { max: MAX_BULK_FILES }),
        );
        return;
      }
      const dt = e.dataTransfer;
      // Drop what the browser put there for the link (its URL), so the drag
      // carries only file identities and cannot be dropped as a link elsewhere.
      dt.clearData();
      dt.setData(FILE_DRAG_MIME, encodeFileDrag(files));
      dt.effectAllowed = "copy";
      // The file's own thumbnail on a small card (a stack with a count for a
      // selection) rather than Chromium's default for a dragged link, which
      // is a chip with the title and URL.
      const drawn = setFileDragImage(dt, {
        thumb: e.currentTarget.querySelector("img"),
        name: fileNameOf(file.relPath),
        placeholder: (file.ext ?? file.kind).toUpperCase(),
        count: files.length,
      });
      if (!drawn && files.length > 1) {
        setCountDragImage(dt, t("drag.fileCount", { count: files.length }));
      }
    },
    [file, readSelection, selected, t],
  );
  if (!enabled) return NONE;
  return { draggable: true, onDragStart };
}

/**
 * A small "N files" badge as the drag image: the fallback for a selection
 * where the card cannot be drawn (no canvas), so the drag still shows how
 * much is being carried.
 * setDragImage needs the element in the document at the moment it is called;
 * it is snapshotted then and can be removed right after.
 */
function setCountDragImage(dt: DataTransfer, label: string): void {
  const el = document.createElement("div");
  el.textContent = label;
  el.className =
    "fixed -left-[9999px] top-0 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow";
  document.body.appendChild(el);
  dt.setDragImage(el, 12, 12);
  setTimeout(() => el.remove(), 0);
}
