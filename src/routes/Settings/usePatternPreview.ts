// The listed files a pattern being typed would hide (#529), so they can be
// checked before it is added. Asked of main once typing pauses; main runs the
// pattern in the auto-tag worker, as a scan would.
import { useEffect, useState } from "react";
import { api } from "@/ipc/client";
import type { PatternPreview } from "@shared/ipc/channels";
import type { ExclusionPattern } from "@shared/scanExclusions";

/** How long typing must pause before the pattern is tried. */
const DELAY_MS = 400;

export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | PatternPreview;

/** What `pattern` covers; null for nothing to try (empty or invalid). */
export function usePatternPreview(
  pattern: ExclusionPattern | null,
): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  const kind = pattern?.kind;
  const value = pattern?.value;
  useEffect(() => {
    if (kind === undefined || value === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to ask: the answer is known now
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    // A later pattern replaces this one: its answer must not overwrite the
    // answer for what is typed now.
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .scanExclusionsPreview({ kind, value })
        .then((preview) => {
          if (!cancelled) setState(preview);
        })
        .catch((e: unknown) => {
          console.error("pattern preview failed:", e);
          if (!cancelled) setState({ status: "error" });
        });
    }, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, value]);

  return state;
}
