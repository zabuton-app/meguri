// The note template a new note starts from (#345), shared through the query
// cache: Settings edits it, the note card reads it when a note is started.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";

export const NOTE_TEMPLATE_QUERY_KEY = ["note_template"] as const;

export function useNoteTemplate(): {
  /** The template as Markdown, "" for none or while it loads. */
  template: string;
  loaded: boolean;
  /** Put a template main has stored into the cache (no IPC). */
  setTemplate: (next: string) => void;
} {
  const qc = useQueryClient();
  // Only Settings changes it, through setTemplate, so the cached value never
  // goes stale on its own.
  const { data } = useQuery({
    queryKey: NOTE_TEMPLATE_QUERY_KEY,
    queryFn: () => api.noteTemplateGet(),
    staleTime: Infinity,
  });
  const setTemplate = useCallback(
    (next: string) => qc.setQueryData(NOTE_TEMPLATE_QUERY_KEY, next),
    [qc],
  );
  return { template: data ?? "", loaded: data !== undefined, setTemplate };
}
