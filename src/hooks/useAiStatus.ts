// Mirror of main's AI state (models, active model, running job) for the
// renderer. One cached query plus the live job: `ai_status` is a snapshot, and
// `ai:progress` is what happens to it, so both are read through here rather
// than reconciled again in every component that wants either.
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  events,
  type AiJobState,
  type AiSettings,
  type AiStatus,
} from "@/ipc/client";

export const AI_STATUS_KEY = ["ai_status"] as const;

export interface AiState {
  status: AiStatus | undefined;
  /** The running job, kept current by the ai:progress event. */
  job: AiJobState | null;
  /** Reported by the terminal ai:progress event when a job failed. */
  jobError: string | null;
  refresh: () => Promise<void>;
  /** Fold settings main just confirmed into the cache, without a round trip. */
  applySettings: (settings: AiSettings) => void;
}

export function useAiStatus(): AiState {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: AI_STATUS_KEY,
    queryFn: () => api.aiStatus(),
    staleTime: 30_000,
    // The AI tab unmounts when another tab is picked, and a job can start or
    // finish while it is gone; a cached snapshot would then show a job that
    // ended, with no event left to correct it.
    refetchOnMount: "always",
  });

  // The job is part of the snapshot, so a progress event updates the snapshot
  // rather than living beside it: one source of truth, and no question of which
  // of the two is newer when the query refetches.
  const [jobError, setJobError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void events
      .onAiProgress((p) => {
        setJobError(p.error ?? null);
        qc.setQueryData(AI_STATUS_KEY, (old: AiStatus | undefined) =>
          old ? { ...old, job: p.job } : old,
        );
        // The end of a job changes more than the job: what is still pending,
        // and whether the tags are up to date.
        if (p.job === null)
          void qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
      })
      .then((un) => {
        if (active) unlisten = un;
        else un();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [qc]);

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: AI_STATUS_KEY }),
    [qc],
  );

  const applySettings = useCallback(
    (settings: AiSettings) => {
      qc.setQueryData(AI_STATUS_KEY, (old: AiStatus | undefined) =>
        old ? { ...old, settings } : old,
      );
      // The settings decide `retagPending`, which only main can work out.
      void qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
    },
    [qc],
  );

  return {
    status: data,
    job: data?.job ?? null,
    jobError,
    refresh,
    applySettings,
  };
}

/** Whether semantic search / similar files can work right now. */
export function useAiEnabled(): boolean {
  return !!useAiStatus().status?.activeModelId;
}
