// Ends the renderer's startup timings (#558) when the first list settles.
import { useEffect } from "react";
import type { AppStatus } from "@shared/ipc/schema";
import { logStartupTimings, startupOutcome } from "@/lib/startupTiming";

export function useStartupTimings(
  status: AppStatus | undefined,
  list: { shown: boolean; failed: boolean },
): void {
  const outcome = startupOutcome(status, list);
  useEffect(() => {
    if (outcome) logStartupTimings(outcome);
  }, [outcome]);
}
