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
// While the detail is docked beside the list as a side peek, the list is on
// screen either way, so a play gesture that switches to another track also
// moves the peek onto that track: it navigates to the detail (autoplay on),
// and the peek starts the track on arrival (see useAudioDetail). Toggling the
// loaded track stays a bar-only action, so the peek is not dragged off
// whatever it shows just to pause.
//
// Subscribes to the actions context only: this hook runs inside memoized,
// virtualized cards, and the state context would re-render all of them on
// every play/pause/volume change — and the docked flag is read at the moment
// of the gesture rather than subscribed to, for the same reason.
import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import type { FileRow } from "@/ipc/types";
import { fileHref, type FileHrefOpts } from "@/lib/fileHref";
import { isPeekDocked } from "@/routes/MediaDetail/peekDocked";
import { useAudioActions } from "./useAudioPlayer";

export function useActivateFile() {
  const navigate = useNavigate();
  const { playOrToggle, isCurrent } = useAudioActions();

  /** The play gesture on an audio row: the bar, or the peek when it is docked. */
  const activateAudio = useCallback(
    (file: FileRow) => {
      if (isPeekDocked() && !isCurrent(file.id, file.workspaceId)) {
        const href = fileHref(file.id, file.workspaceId);
        // Unless the peek already shows this track (it was closed from the
        // bar, say): arriving at the same URL again would not start it, as
        // the peek only auto-starts once per visit, so the bar takes it.
        // Read from the hash rather than useLocation(), which would re-render
        // every card on each navigation.
        if (window.location.hash.slice(1) !== href) {
          void navigate(href);
          return;
        }
      }
      playOrToggle(file, file.workspaceId);
    },
    [isCurrent, navigate, playOrToggle],
  );

  /** Keyboard / programmatic activation. `autoplay: false` is the inspect gesture. */
  const activate = useCallback(
    (file: FileRow, opts?: FileHrefOpts) => {
      if (file.kind === "audio" && opts?.autoplay !== false) {
        activateAudio(file);
        return;
      }
      void navigate(fileHref(file.id, file.workspaceId, opts));
    },
    [navigate, activateAudio],
  );

  /** For the thumbnail <Link>: intercepts audio so the router never sees the click. */
  const onThumbnailClick = useCallback(
    (file: FileRow) => (e: MouseEvent) => {
      if (file.kind !== "audio") return;
      e.preventDefault();
      activateAudio(file);
    },
    [activateAudio],
  );

  return { activate, onThumbnailClick };
}
