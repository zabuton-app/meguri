// The pet's speech bubble: the file it brought back (thumbnail, a line saying
// why) or a line saying it found nothing. Only ever shown on request.
import { useEffect, useEffectEvent, useRef } from "react";
import { useAppStatus } from "@/hooks/useAppStatus";
import type { FileRow } from "@/ipc/types";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";

/** How long the bubble stays up before closing on its own. */
const BUBBLE_MS = 8000;
/**
 * Half the bubble's width (w-56 below) plus the gap it keeps from the window
 * edge, in px: how close to an edge its centre may come. The two must agree.
 */
export const BUBBLE_REACH = 120;

export interface PetBubbleProps {
  line: string;
  /** The file brought back, or null when there was nothing to bring. */
  file: FileRow | null;
  /** Sideways offset (px) that keeps the bubble inside the window. */
  shift: number;
  /** The pet is covered or out of sight: the bubble's time stops running. */
  paused: boolean;
  onOpen: (file: FileRow) => void;
  onClose: () => void;
}

export function PetBubble({
  line,
  file,
  shift,
  paused,
  onOpen,
  onClose,
}: PetBubbleProps) {
  const mediaBase = useAppStatus().data?.mediaBase ?? "";
  const close = useEffectEvent(onClose);
  // Only time spent in view counts: a bubble covered by a modal is still
  // there, with what was left of its time, once the modal is gone.
  const remaining = useRef(BUBBLE_MS);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const id = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started),
      );
    };
  }, [paused]);

  const thumb =
    file && hasThumbFile(file)
      ? thumbUrl(mediaBase, file.workspaceId, file.id)
      : null;
  const name = file?.relPath.split("/").pop() ?? null;
  const frame =
    "flex w-full items-center gap-2 rounded-lg border border-border bg-popover p-2 text-left text-sm text-popover-foreground shadow-lg shadow-black/25";
  return (
    <div
      role="status"
      className="absolute bottom-full left-1/2 mb-2 w-56"
      style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
    >
      {file ? (
        <button
          type="button"
          onClick={() => onOpen(file)}
          className={`${frame} cursor-pointer hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {thumb && (
            <img
              src={thumb}
              alt=""
              draggable={false}
              className="size-12 shrink-0 rounded object-cover"
            />
          )}
          <span className="flex min-w-0 flex-col">
            <span>{line}</span>
            <span className="truncate text-xs text-muted">{name}</span>
          </span>
        </button>
      ) : (
        <div className={frame}>{line}</div>
      )}
    </div>
  );
}
