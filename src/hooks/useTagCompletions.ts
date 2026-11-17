// Tag completions from the library's tag catalog, shared by the search box and
// the command menu's `tag:` page so the two rank and mark tags the same way.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { TagSummary } from "@/ipc/types";
import { useAppStatus } from "@/hooks/useAppStatus";
import {
  tagSuggestions,
  viewIsOneWorkspace,
  withClosedValues,
  type PendingDirective,
} from "@/lib/searchTokens";

export interface TagCompletions {
  suggestions: TagSummary[];
  /** Whether a tag is on view; one held only elsewhere is offered muted. */
  held: (tag: TagSummary) => boolean;
}

/** Completions for `pending`; null asks for none and leaves the catalog unfetched. */
export function useTagCompletions(
  pending: PendingDirective | null,
): TagCompletions {
  const status = useAppStatus();
  // The catalog of the whole library, not of the view: a tag held in another
  // workspace is still a tag to look for. Under the tag management screen's
  // key, so every tag mutation invalidates it as it does that screen's;
  // `enabled` keeps it unfetched until a directive is actually being typed.
  // Filtering client-side beats a round trip per keystroke — the catalog is
  // capped at MAX_TAG_LIST. Past the cap the view's own tags are kept first,
  // so the key carries the view and a switch fetches the catalog again.
  const viewId = status.data?.workspaceId ?? null;
  const catalog = useQuery({
    queryKey: ["tags_list_all", "library", viewId],
    queryFn: () => api.tagsListAll({ allWorkspaces: true }),
    enabled: (status.data?.ready ?? false) && pending !== null,
  });
  // Whether a tag is on view: in the workspace shown, or anywhere when all of
  // them (or a collection, which spans them) is.
  const held = useCallback(
    (tag: TagSummary) =>
      viewId === null ||
      !viewIsOneWorkspace(viewId) ||
      tag.workspaceIds.includes(viewId),
    [viewId],
  );
  // Once a closed set's namespace is typed, its values are offered even when
  // no file carries one yet (`tag:audio_quality:` lists all three).
  const tags = useMemo(
    () => withClosedValues(catalog.data?.tags ?? [], pending?.value ?? ""),
    [catalog.data, pending?.value],
  );
  const offered = useCallback(
    (tag: TagSummary) => tag.fileCount === 0 || held(tag),
    [held],
  );
  const suggestions = useMemo(
    () => (pending ? tagSuggestions(tags, pending, undefined, offered) : []),
    [tags, pending, offered],
  );
  return { suggestions, held: offered };
}
