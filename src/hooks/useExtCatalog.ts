// The extensions the library's files have, for completing `ext:` in the
// command menu (#731). Read and kept as the tag catalog for completion is
// (useTagCompletions): every workspace, fetched only while `ext:` is typed,
// kept a minute, and read again where that catalog is.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { ExtSummary } from "@/ipc/types";
import { useAppStatus } from "@/hooks/useAppStatus";
import { viewIsOneWorkspace } from "@/lib/searchTokens";

export const EXT_CATALOG_QUERY_KEY = ["ext_list_all"] as const;

export interface ExtCatalog {
  /** The extensions, those on view first, then by how many files have each. */
  exts: string[];
  summary: (ext: string) => ExtSummary | undefined;
  /** Whether a file on view has it; one held only elsewhere is offered muted. */
  held: (ext: string) => boolean;
}

export function useExtCatalog(enabled: boolean): ExtCatalog {
  const status = useAppStatus();
  const viewId = status.data?.workspaceId ?? null;
  const { data } = useQuery({
    queryKey: EXT_CATALOG_QUERY_KEY,
    queryFn: () => api.extListAll(),
    enabled: (status.data?.ready ?? false) && enabled,
    staleTime: 60_000,
  });
  const byExt = useMemo(
    () => new Map((data?.extensions ?? []).map((e) => [e.ext, e])),
    [data],
  );
  const held = useCallback(
    (ext: string) =>
      viewId === null ||
      !viewIsOneWorkspace(viewId) ||
      (byExt.get(ext)?.workspaceIds.includes(viewId) ?? false),
    [viewId, byExt],
  );
  const exts = useMemo(() => {
    const all = (data?.extensions ?? []).map((e) => e.ext);
    return [...all.filter(held), ...all.filter((ext) => !held(ext))];
  }, [data, held]);
  const summary = useCallback((ext: string) => byExt.get(ext), [byExt]);
  return { exts, summary, held };
}
