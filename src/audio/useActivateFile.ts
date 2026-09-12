// What activating a library item does, shared by MediaGrid, MediaList,
// MediaTable and DiscoverCard so the views cannot drift.
//
// Video and images always open the detail view. Audio is split by intent: the
// "play" gesture (thumbnail click, Enter on the focused item, the table's
// thumbnail cell, Discover's Play) plays the track in the bottom bar without
// leaving the list, while the "inspect" gesture (the name / metadata region,
// `autoplay: false`) opens the detail view silently. A play gesture on the
// track already in the bar toggles it rather than restarting from zero.
//
// Subscribes to the actions context only: this hook runs inside memoized,
// virtualized cards, and the state context would re-render all of them on
// every play/pause/volume change.
import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import type { FileRow } from "@/ipc/types";
import { fileHref, type FileHrefOpts } from "@/lib/fileHref";
import { useAudioActions } from "./useAudioPlayer";

export function useActivateFile() {
  const navigate = useNavigate();
  const { playOrToggle } = useAudioActions();

  /** Keyboard / programmatic activation. `autoplay: false` is the inspect gesture. */
  const activate = useCallback(
    (file: FileRow, opts?: FileHrefOpts) => {
      if (file.kind === "audio" && opts?.autoplay !== false) {
        playOrToggle(file, file.workspaceId);
        return;
      }
      void navigate(fileHref(file.id, file.workspaceId, opts));
    },
    [navigate, playOrToggle],
  );

  /** For the thumbnail <Link>: intercepts audio so the router never sees the click. */
  const onThumbnailClick = useCallback(
    (file: FileRow) => (e: MouseEvent) => {
      if (file.kind !== "audio") return;
      e.preventDefault();
      playOrToggle(file, file.workspaceId);
    },
    [playOrToggle],
  );

  return { activate, onThumbnailClick };
}
