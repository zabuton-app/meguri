// Watch Later membership, resolved once per list view instead of once per row.
//
// The per-item toggle needs two things: the built-in collection's id, and
// whether a given file is already on it. Reading that from inside every card
// meant one query observer per rendered row (so a workspaces_list invalidation
// re-rendered all of them) plus a linear scan of the collection's items per row.
// Views call this once and hand the result down.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { WATCH_LATER_ID } from "@shared/workspaceIds";

export interface WatchLaterMembership {
  /** Collection id, or null while the workspace list is still loading. */
  id: string | null;
  /** Whether the given file is currently queued. */
  has: (workspaceId: string, fileId: number) => boolean;
}

/** Key for the membership set. File ids are only unique within a workspace. */
function memberKey(workspaceId: string, fileId: number): string {
  return `${workspaceId}:${fileId}`;
}

export function useWatchLater(): WatchLaterMembership {
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const watchLater =
    workspaces.data?.collections.find((c) => c.id === WATCH_LATER_ID) ?? null;
  const items = watchLater?.items;

  const members = useMemo(
    () => new Set((items ?? []).map((i) => memberKey(i.workspaceId, i.fileId))),
    [items],
  );

  return useMemo(
    () => ({
      id: watchLater?.id ?? null,
      has: (workspaceId: string, fileId: number) =>
        members.has(memberKey(workspaceId, fileId)),
    }),
    [watchLater?.id, members],
  );
}
