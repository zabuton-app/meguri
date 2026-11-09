import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import { z } from "zod";
import {
  SearchFilterFieldsSchema,
  SearchQuerySchema,
  type SearchQuery,
} from "@shared/ipc/schema";
import { ALL_ID } from "@/ipc/client";
import {
  cleanConditions,
  loadInitialFilter,
  type SmartCollection,
} from "@/lib/smartCollections";
import {
  compatibleBinFilters,
  patchIncoming,
  queryWithinBin,
} from "@/lib/binFilters";
import { onBrowseLibrary } from "@/lib/ui-events";
import { loadRecentView } from "@/lib/recentFiles";
import { isLocalWorkspace, type LibraryScope } from "./useLibraryLocation";
import {
  enableHeldFilter,
  mergeHeldFilters,
  hasHeldFilters,
} from "@/lib/heldFilters";

export const LIBRARY_FILTERS_KEY = "meguri.libraryFilters.v1";
const SessionSchema = z.object({
  incoming: SearchQuerySchema,
  selection: z
    .object({
      id: z.string(),
      workspaceId: z.string().nullable(),
      applied: SearchQuerySchema,
      omitted: SearchFilterFieldsSchema,
    })
    .nullable(),
});
type Session = z.infer<typeof SessionSchema>;

function initialSession(
  collections: SmartCollection[],
  defaultId: string | null,
): Session {
  try {
    const stored = SessionSchema.safeParse(
      JSON.parse(localStorage.getItem(LIBRARY_FILTERS_KEY) ?? "null"),
    );
    if (stored.success) {
      if (
        stored.data.selection &&
        !collections.some((bin) => bin.id === stored.data.selection?.id)
      )
        stored.data.selection = null;
      return stored.data;
    }
  } catch {
    /* Use the previous launch preferences when no valid session exists. */
  }
  const recent = loadRecentView();
  return {
    incoming: collections.some((bin) => bin.id === defaultId && bin.scope)
      ? recent
        ? {
            recent,
            sort: recent.basis === "added" ? "added" : "btime",
            sortDir: "desc",
          }
        : {}
      : loadInitialFilter(),
    selection: null,
  };
}

/** Saved bin membership, global incoming filters, and this visit's accepted filters are separate. */
export function useLibraryFilters(
  collections: SmartCollection[],
  defaultId: string | null,
  workspaceId: string | null,
  scopeOverride?: LibraryScope | null,
) {
  const [session, setSession] = useState(() =>
    initialSession(collections, defaultId),
  );
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_FILTERS_KEY, JSON.stringify(session));
    } catch {
      /* Keep browsing when storage is unavailable. */
    }
  }, [session]);
  const selectedBin = collections.find(
    (bin) => bin.id === session.selection?.id,
  );
  const expectedScope =
    selectedBin?.scope === "all"
      ? ALL_ID
      : (selectedBin?.workspaceId ?? session.selection?.workspaceId);
  const activeBin =
    selectedBin &&
    (scopeOverride === undefined
      ? session.selection?.workspaceId === workspaceId &&
        expectedScope === workspaceId
      : scopeOverride === "global"
        ? workspaceId === ALL_ID
        : scopeOverride === "local" && isLocalWorkspace(workspaceId))
      ? selectedBin
      : undefined;
  const storedControls =
    activeBin && session.selection
      ? session.selection.applied
      : session.incoming;
  const compatibility = useMemo(
    () =>
      activeBin ? compatibleBinFilters(storedControls, activeBin.query) : null,
    [activeBin, storedControls],
  );
  const controls = compatibility?.applied ?? storedControls;
  const omitted = useMemo(
    () =>
      activeBin
        ? mergeHeldFilters(
            session.selection?.omitted ?? {},
            compatibility?.omitted ?? {},
          )
        : undefined,
    [activeBin, session.selection?.omitted, compatibility],
  );
  useEffect(() => {
    if (
      !activeBin ||
      !compatibility ||
      !Object.keys(compatibility.omitted).length
    )
      return;
    // External bin edits may deactivate newly incompatible filters, never enable old ones.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession((previous) => {
      if (previous.selection?.id !== activeBin.id) return previous;
      const checked = compatibleBinFilters(
        previous.selection.applied,
        activeBin.query,
      );
      if (!Object.keys(checked.omitted).length) return previous;
      return {
        ...previous,
        selection: {
          ...previous.selection,
          applied: checked.applied,
          omitted: mergeHeldFilters(
            previous.selection.omitted,
            checked.omitted,
          ),
        },
      };
    });
  }, [activeBin, compatibility]);
  const query = useMemo(
    () =>
      activeBin
        ? {
            ...queryWithinBin(controls, activeBin.query),
            ...(hasHeldFilters(omitted ?? {}, controls)
              ? { matchNone: true }
              : {}),
          }
        : controls,
    [activeBin, controls, omitted],
  );

  const setControls = useCallback(
    (update: SetStateAction<SearchQuery>) => {
      setSession((previous) => {
        const bin = collections.find(
          (candidate) => candidate.id === previous.selection?.id,
        );
        const expected =
          bin?.scope === "all"
            ? ALL_ID
            : (bin?.workspaceId ?? previous.selection?.workspaceId);
        const inside =
          !!bin &&
          (scopeOverride === undefined
            ? previous.selection?.workspaceId === workspaceId &&
              expected === workspaceId
            : scopeOverride === "global"
              ? workspaceId === ALL_ID
              : scopeOverride === "local" && isLocalWorkspace(workspaceId));
        const checked =
          inside && previous.selection && bin
            ? compatibleBinFilters(previous.selection.applied, bin.query)
            : null;
        const before = checked?.applied ?? previous.incoming;
        const after = cleanConditions(
          typeof update === "function" ? update(before) : update,
        );
        if (!inside || !previous.selection)
          return { incoming: after, selection: null };
        const incoming = patchIncoming(previous.incoming, before, after);
        // Excluded rules remain out for the whole visit. Only explicit edits can
        // add them again; bin edits never rerun compatibility behind the user.
        const omitted = mergeHeldFilters(
          previous.selection.omitted,
          checked?.omitted ?? {},
        );
        for (const key of Object.keys(after) as (keyof SearchQuery)[]) {
          if (JSON.stringify(after[key]) === JSON.stringify(before[key]))
            continue;
          if (key === "audio" && omitted.audio) {
            const audio = { ...omitted.audio };
            for (const field of Object.keys(
              after.audio ?? {},
            ) as (keyof typeof audio)[])
              if (after.audio?.[field] !== before.audio?.[field])
                delete audio[field];
            if (Object.keys(audio).length) omitted.audio = audio;
            else delete omitted.audio;
          } else delete omitted[key];
        }
        return {
          incoming,
          selection: { ...previous.selection, applied: after, omitted },
        };
      });
    },
    [collections, workspaceId, scopeOverride],
  );

  const setQuery = useCallback(
    (update: SetStateAction<SearchQuery>) => {
      // Existing tag/keyboard actions edit the effective query. The bin's clauses
      // stay owned here, so those actions only change the visitor's controls.
      setControls((before) => {
        const effective = activeBin
          ? queryWithinBin(before, activeBin.query)
          : before;
        const next = typeof update === "function" ? update(effective) : update;
        return activeBin ? patchIncoming(before, effective, next) : next;
      });
    },
    [activeBin, setControls],
  );

  const enter = useCallback(
    (bin: SmartCollection) => {
      setSession((previous) => {
        if (!bin.scope)
          return { incoming: cleanConditions(bin.query), selection: null };
        const target =
          scopeOverride === undefined
            ? bin.scope === "all"
              ? ALL_ID
              : (bin.workspaceId ?? workspaceId)
            : scopeOverride === "local"
              ? workspaceId
              : ALL_ID;
        if (previous.selection?.id === bin.id)
          return {
            ...previous,
            selection: { ...previous.selection, workspaceId: target },
          };
        const { applied, omitted } = compatibleBinFilters(
          previous.incoming,
          bin.query,
        );
        return {
          ...previous,
          selection: { id: bin.id, workspaceId: target, applied, omitted },
        };
      });
    },
    [workspaceId, scopeOverride],
  );
  const leave = useCallback(
    () =>
      setSession((previous) =>
        previous.selection ? { ...previous, selection: null } : previous,
      ),
    [],
  );
  useEffect(
    () =>
      onBrowseLibrary((navigation) => {
        if (
          scopeOverride !== undefined &&
          navigation.keepBin &&
          navigation.workspaceId
        ) {
          setSession((previous) =>
            previous.selection
              ? {
                  ...previous,
                  selection: {
                    ...previous.selection,
                    workspaceId: navigation.workspaceId!,
                  },
                }
              : previous,
          );
        } else leave();
      }),
    [leave, scopeOverride],
  );
  useEffect(() => {
    // Reconcile deletion from the external saved-bin store, once per deletion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session.selection && !selectedBin) leave();
  }, [session.selection, selectedBin, leave]);

  return {
    query,
    setQuery,
    controls,
    setControls,
    enter,
    leave,
    activeBin,
    omitted,
    enableOmitted: (patch: SearchQuery) => {
      if (
        !activeBin ||
        Object.keys(compatibleBinFilters(patch, activeBin.query).omitted).length
      )
        return;
      setControls((before) => enableHeldFilter(before, patch));
    },
    removeOmitted: (clear: (query: SearchQuery) => SearchQuery) => {
      setSession((previous) =>
        previous.selection
          ? {
              incoming: cleanConditions(clear(previous.incoming)),
              selection: {
                ...previous.selection,
                omitted: clear(previous.selection.omitted),
              },
            }
          : previous,
      );
    },
    launchBin:
      selectedBin ??
      collections.find((bin) => bin.id === defaultId && bin.scope),
    clear: () =>
      setSession((previous) => ({
        incoming: {},
        selection: previous.selection
          ? { ...previous.selection, applied: {}, omitted: {} }
          : null,
      })),
  };
}
