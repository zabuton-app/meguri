// Single definition of "what activating a library item does", shared by MediaGrid,
// MediaList, and MediaTable.
//
// Audio never opens the detail modal — it loads into the bottom player bar instead
// (FR-010). Keeping this in one hook is what makes the three views behave identically
// for click, keyboard activation, and activation from a collection or history view;
// a view that still navigates for audio would be a defect.
import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import type { FileRow } from "@/ipc/types";
import { fileHref, type FileHrefOpts } from "@/lib/fileHref";
import { useAudioPlayer } from "./useAudioPlayer";

export function isAudio(file: Pick<FileRow, "kind">): boolean {
  return file.kind === "audio";
}

export function useActivateFile() {
  const navigate = useNavigate();
  const { play } = useAudioPlayer();

  /** Activate by navigation semantics (keyboard Enter, row click). */
  const activate = useCallback(
    (file: FileRow, opts?: FileHrefOpts) => {
      if (isAudio(file)) {
        play(file, file.workspaceId);
        return;
      }
      void navigate(fileHref(file.id, file.workspaceId, opts));
    },
    [navigate, play],
  );

  /** For <Link> call sites: intercepts audio so the router never sees the click. */
  const onLinkClick = useCallback(
    (file: FileRow) => (e: MouseEvent) => {
      if (!isAudio(file)) return;
      e.preventDefault();
      play(file, file.workspaceId);
    },
    [play],
  );

  return { activate, onLinkClick };
}
