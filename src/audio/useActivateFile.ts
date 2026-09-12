// What activating a library item does, shared by MediaGrid, MediaList and
// MediaTable so the three views cannot drift.
//
// Video and images always open the detail view. Audio is split by intent: the
// "play" gesture (thumbnail click, Enter on the focused item, the table's
// thumbnail cell) plays the track in the bottom bar without leaving the list,
// while the "inspect" gesture (the name / metadata region, `autoplay: false`)
// opens the detail view silently. A play gesture on the track already in the
// bar toggles it rather than restarting from zero.
import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import type { FileRow } from "@/ipc/types";
import { fileHref, type FileHrefOpts } from "@/lib/fileHref";
import { useAudioPlayer } from "./useAudioPlayer";

export function useActivateFile() {
  const navigate = useNavigate();
  const { play, toggle, current } = useAudioPlayer();

  const playInBar = useCallback(
    (file: FileRow) => {
      if (
        current?.file.id === file.id &&
        current.workspaceId === file.workspaceId
      ) {
        toggle();
        return;
      }
      play(file, file.workspaceId);
    },
    [current, play, toggle],
  );

  /** Keyboard / programmatic activation. `autoplay: false` is the inspect gesture. */
  const activate = useCallback(
    (file: FileRow, opts?: FileHrefOpts) => {
      if (file.kind === "audio" && opts?.autoplay !== false) {
        playInBar(file);
        return;
      }
      void navigate(fileHref(file.id, file.workspaceId, opts));
    },
    [navigate, playInBar],
  );

  /** For the thumbnail <Link>: intercepts audio so the router never sees the click. */
  const onThumbnailClick = useCallback(
    (file: FileRow) => (e: MouseEvent) => {
      if (file.kind !== "audio") return;
      e.preventDefault();
      playInBar(file);
    },
    [playInBar],
  );

  return { activate, onThumbnailClick };
}
