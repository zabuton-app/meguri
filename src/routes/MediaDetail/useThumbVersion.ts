import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events } from "@/ipc/client";
import type { FileDetail } from "@/ipc/types";
import { hasThumbFile } from "@/lib/thumbUrl";

/**
 * Cache-bust the on-page main-thumbnail preview after regeneration. The main
 * process emits `thumb:done` once ffmpeg finishes; bumping the version flips
 * the `?v=` query and forces the browser to refetch the rewritten WebP.
 *
 * The event also means a file now exists behind the slot: an audio track
 * opened while the scan was still extracting covers was fetched with
 * `hasThumb: 0`, and the cover would otherwise stay hidden until a refetch.
 */
export function useThumbVersion(fileId: number, wsId: string): number {
  const qc = useQueryClient();
  const [thumbVersion, setThumbVersion] = useState(0);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        if (
          event.id === fileId &&
          (!event.workspaceId || event.workspaceId === wsId)
        ) {
          setThumbVersion((v) => v + 1);
          qc.setQueryData<FileDetail | null>(
            ["file_get", wsId, fileId],
            (old) =>
              old && !hasThumbFile(old)
                ? { ...old, thumbStatus: "done", hasThumb: 1 }
                : old,
          );
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [fileId, wsId, qc]);
  return thumbVersion;
}
