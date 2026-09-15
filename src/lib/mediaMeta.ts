// The one-line resolution / duration summary under a file's name, shared by
// the grid card and the home landing card so the two never drift.
import type { FileRow } from "@/ipc/types";
import { hasTimeline } from "@/lib/mediaKind";
import { formatDuration } from "@/lib/format";

/** Builds the resolution/duration metadata line (omitting missing items). */
export function metaLine(file: FileRow): string {
  const dims =
    file.width && file.height ? `${file.width}×${file.height}` : null;
  const dur =
    hasTimeline(file.kind) && file.duration
      ? formatDuration(file.duration)
      : null;
  return [dims, dur].filter(Boolean).join(" · ") || "—";
}
