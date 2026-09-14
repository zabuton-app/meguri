import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { playHref, type PlayHrefOpts } from "@/lib/playHref";
import { DISCOVER_FILTER_PARAM } from "@/routes/Home/utils";
import { announceVideoHandOff } from "@/video/videoHandOff";
import type { PlayerHandle } from "./VideoPlayer";

/**
 * Where leaving the detail view lands.
 *
 * Closing the modal = drop the child route. Return to Discovery or the playlist
 * player if we came from there, otherwise back to the list (the list stays
 * mounted underneath). A detail opened from outside the router (the bottom
 * bar) goes back to the route it was opened over. The way *into* the playlist
 * from here (`openPlaylist`) is the mirror of the player's own "open details":
 * play the list this file sits in, starting on this file, with its playback
 * carried over.
 */
export function useCloseTarget({
  fileId,
  wsId,
  startAt,
  playerRef,
  mediaSrc,
}: {
  fileId: number;
  wsId: string;
  /** The second this view arrived at (`?t=`). */
  startAt: number;
  playerRef: RefObject<PlayerHandle | null>;
  /** The file's media URL; handed across only while a video player is mounted. */
  mediaSrc: string;
}): { onClose: () => void; openPlaylist: () => void } {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Read through a ref: the source is derived from the status query and
  // must not re-create the close callback.
  const mediaSrcRef = useRef("");
  useLayoutEffect(() => {
    mediaSrcRef.current = mediaSrc;
  }, [mediaSrc]);

  // Hand this view's playback over to the playlist player, which is about to
  // show this very file. Where this player got to goes into `t` — not where
  // the playlist left off when it came here, since watching on for a few
  // minutes and then being rewound to the second of the detour reads as a bug.
  // Until its metadata has loaded this player has no position yet, so leaving
  // straight away falls back to the second this view arrived at rather than
  // rewinding to the top of the file. The <video> itself is handed across as
  // it is (see videoHandOff.ts), so the playlist need not reload and seek to
  // `t` at all; `t` is the fallback for when that hand-off does not happen.
  // Navigates itself: the announcement is only good for the navigation that
  // follows it at once, so the two are not offered separately.
  // An audio track is not this view's to hand over: it plays in the bottom
  // bar, which the playlist shares, so it simply carries on. Only a video has
  // a player here.
  //
  // A video watched to its end is a different matter for a fresh pass: the
  // player would adopt it at the end and, as with any item that has ended,
  // move straight on — skipping the very file the user asked to start on. So
  // a fresh pass gets no hand-off and no `t` then, and plays the file over
  // from the top. (A detour resuming on an ended video *should* move on.)
  const leaveForPlayer = useCallback(
    (to: PlayHrefOpts, replace = false) => {
      const player = playerRef.current;
      if (!to.resume && player?.ended()) {
        void navigate(playHref(to), { replace });
        return;
      }
      const sec = player?.currentTime();
      const handBack =
        sec != null && Number.isFinite(sec) ? Math.floor(sec) : startAt;
      if (player && mediaSrcRef.current)
        announceVideoHandOff(mediaSrcRef.current);
      void navigate(playHref({ ...to, t: handBack }), { replace });
    },
    [navigate, playerRef, startAt],
  );

  const from = searchParams.get("from");
  // The playlist player parked its pass on the way here (`from=player`), so
  // leaving hands playback back rather than dropping the user on the list.
  const returnToParkedPass = useCallback(() => {
    // Name the file the pass was parked on: the player restores only when
    // this matches what it put aside, so a stale pass can never be picked up
    // by an unrelated later playback (or by walking the history back here) —
    // that case starts a fresh pass on this file instead, hence `start` too.
    const file = { workspaceId: searchParams.get("ws") ?? "", fileId };
    // Replaced, not pushed: the detour is one round trip, and a growing
    // history would offer a "back" that lands on a pass already spent.
    leaveForPlayer({ resume: file, start: file }, true);
  }, [fileId, leaveForPlayer, searchParams]);

  const onClose = useCallback(() => {
    const state = location.state as {
      outsideRouter?: boolean;
      origin?: string;
    } | null;
    if (state?.outsideRouter) {
      // The origin is restored without the detour marker: it is the route
      // the detour started from, not itself a detour. Carrying the marker
      // would matter when the origin is another file's detail (the bar is in
      // reach while the detail is docked as a side peek): that detail would
      // then "return" to itself on every close and could never be left.
      void navigate(state.origin || "/", { replace: true });
      return;
    }
    if (from === "player") {
      returnToParkedPass();
      return;
    }
    if (from !== "discover") {
      void navigate("/");
      return;
    }
    const params = new URLSearchParams();
    const filter = searchParams.get(DISCOVER_FILTER_PARAM);
    if (filter) params.set(DISCOVER_FILTER_PARAM, filter);
    const query = params.toString();
    void navigate(query ? `/discover?${query}` : "/discover");
  }, [from, location.state, navigate, returnToParkedPass, searchParams]);

  // A detour from the player already has a pass waiting: go back to it
  // rather than throw it away for a fresh one. Its parked pass may be gone
  // by now (the history walked back here); the fallback is the list.
  const openPlaylist = useCallback(() => {
    if (from === "player") {
      returnToParkedPass();
      return;
    }
    leaveForPlayer({ start: { workspaceId: wsId, fileId } });
  }, [fileId, from, leaveForPlayer, returnToParkedPass, wsId]);

  return { onClose, openPlaylist };
}
