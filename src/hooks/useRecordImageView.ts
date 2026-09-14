import { useEffect, useRef } from "react";
import { api } from "@/ipc/client";

/**
 * Record viewing an image as a play. Images have no player to fire a `play`
 * event, so the view itself is the play record — which is also what takes the
 * file off Watch Later. Shared by the detail view and the playlist player.
 *
 * The ref dedupes the refetches/re-renders of a single visit. Once the caller
 * settles on a non-image (`kind` known and not "image"), the guard is dropped
 * so coming back to the same image (image → video → the same image, which a
 * playlist reaches routinely with repeat, shuffle or stepping back) records a
 * new view. The guard is kept while `kind` is still undefined (the next file
 * loading) so a transient fetch state cannot cause double records.
 */
export function useRecordImageView({
  wsId,
  fileId,
  kind,
  onRecorded,
}: {
  wsId: string;
  fileId: number | null | undefined;
  /** The file's kind, or undefined while it is not yet known. */
  kind: string | undefined;
  /** Runs once the main process has confirmed the record. */
  onRecorded?: (wsId: string, fileId: number) => void;
}): void {
  const recordedRef = useRef<string | null>(null);
  // Read at completion time so a changing callback never re-runs the effect.
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  });
  useEffect(() => {
    if (
      kind !== "image" ||
      !wsId ||
      fileId == null ||
      !Number.isFinite(fileId)
    ) {
      if (kind !== undefined) recordedRef.current = null;
      return;
    }
    const key = `${wsId}:${fileId}`;
    if (recordedRef.current === key) return;
    recordedRef.current = key;
    api
      .fileRecordPlay(fileId, wsId, "browser")
      .then(() => onRecordedRef.current?.(wsId, fileId))
      .catch(() => {
        // Drop the guard on failure so a later effect run of this visit can
        // retry; without this a transient IPC error would suppress the record
        // for good.
        if (recordedRef.current === key) recordedRef.current = null;
      });
  }, [kind, fileId, wsId]);
}
