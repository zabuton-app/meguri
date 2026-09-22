// Mirror of main's AI state (models, active model, running job) for the
// renderer.
//
// Reading and subscribing are separate on purpose. `useAiStatus` only reads the
// cached snapshot, so a screen that merely asks whether AI is on does not
// become an event subscriber; `useAiProgress` is what listens, and the one
// screen that watches a job running mounts it.
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
    refresh,
    applySettings,
  };
}

/**
 * Whether semantic search, similar files and Analyze can work right now.
 *
 * Its own observer with a `select`: this is read by the detail view, which
 * would otherwise re-render on every progress tick for a boolean that did not
 * change.
 */
export function useAiEnabled(): boolean {
  const { data } = useQuery({
    queryKey: AI_STATUS_KEY,
    queryFn: () => api.aiStatus(),
    staleTime: 30_000,
    select: (s: AiStatus) => !!s.activeModelId,
  });
  return data ?? false;
}

/**
 * Subscribe to the running job and keep the cached status in step with it.
 * Returns the message of the last failure, if the job ended in one.
 *
 * Mounted by whatever is showing the job — the settings screen — rather than by
 * every reader of the status, so a subscription exists only while someone is
 * looking at it.
 */
export function useAiProgress(): string | null {
  const qc = useQueryClient();
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
  return jobError;
}
