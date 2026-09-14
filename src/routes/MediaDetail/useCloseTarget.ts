import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { announceVideoHandOff } from "@/video/videoHandOff";
import type { PlayerHandle } from "./VideoPlayer";

/**
 * Where closing the detail view lands.
 *
 * Closing the modal = drop the child route. Return to Discovery or the playlist
 * player if we came from there, otherwise back to the list (the list stays
 * mounted underneath). A detail opened from outside the router (the bottom
 * bar) goes back to the route it was opened over.
 */
export function useCloseTarget({
  fileId,
  playerRef,
  mediaSrc,
}: {
  fileId: number;
  playerRef: RefObject<PlayerHandle | null>;
  /** The stream URL of a video on screen ("" for anything else). */
  mediaSrc: string;
}): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Read through a ref: the source is derived from the status query and
  // must not re-create the close callback.
  const mediaSrcRef = useRef("");
  useLayoutEffect(() => {
    mediaSrcRef.current = mediaSrc;
  }, [mediaSrc]);

  return useCallback(() => {
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
    const from = searchParams.get("from");
    // The playlist player parked its pass on the way here, so closing hands
    // playback back rather than dropping the user on the list.
    if (from === "player") {
      const params = new URLSearchParams();
      // Name the file the pass was parked on: the player restores only when
      // this matches what it put aside, so a stale pass can never be picked up
      // by an unrelated later playback (or by walking the history back here).
      params.set("resume", `${searchParams.get("ws") ?? ""}:${fileId}`);
      // Hand back where this player got to, not where the playlist left off —
      // watching on for a few minutes here and then being rewound to the second
      // of the detour reads as a bug. Until its metadata has loaded this player
      // still reports 0, so closing straight away falls back to the second the
      // detour was taken at rather than rewinding to the top of the file.
      // An audio track is not this view's to hand back: it plays in the bottom
      // bar, which the playlist shares, so it simply carries on.
      const arrived = Number(searchParams.get("t")) || 0;
      const sec = playerRef.current?.currentTime();
      const handBack =
        sec != null && Number.isFinite(sec) && sec > 0
          ? Math.floor(sec)
          : arrived;
      if (handBack > 0) params.set("t", String(handBack));
      // The playlist resumes this very file: hand it the <video> as it is
      // (see videoHandOff.ts) instead of having it reload and seek to `t`.
      // Only a video has a player here.
      if (playerRef.current && mediaSrcRef.current)
        announceVideoHandOff(mediaSrcRef.current);
      // Replaced, not pushed: the detour is one round trip, and a growing
      // history would offer a "back" that lands on a pass already spent.
      void navigate(`/play?${params.toString()}`, { replace: true });
      return;
    }
    if (from !== "discover") {
      void navigate("/");
      return;
    }
    const params = new URLSearchParams();
    const filter = searchParams.get("filter");
    if (filter) params.set("filter", filter);
    const query = params.toString();
    void navigate(query ? `/discover?${query}` : "/discover");
  }, [fileId, location.state, navigate, playerRef, searchParams]);
}
