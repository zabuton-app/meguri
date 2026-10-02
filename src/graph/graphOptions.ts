// The graph view's toggles, remembered across sessions (per viewer, not per
// workspace: they describe how the viewer likes to look at a graph).
import { useCallback, useState } from "react";
import type { EdgeSourceId } from "@shared/ipc/graph";
import { EDGE_SOURCE_INFO } from "./edgeSources";
import type { VisibilityOptions } from "./model/visibility";

export const GRAPH_OPTIONS_KEY = "meguri.graph.options";

export function defaultGraphOptions(): VisibilityOptions {
  const edgeSources: Partial<Record<EdgeSourceId, boolean>> = {};
  for (const s of EDGE_SOURCE_INFO) edgeSources[s.id] = s.defaultOn;
  return { edgeSources, showAutoTags: false, showOrphans: false };
}

/** A stored value, with anything unexpected replaced by the default. */
export function parseGraphOptions(raw: string | null): VisibilityOptions {
  const fallback = defaultGraphOptions();
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return fallback;
    const o = v as Record<string, unknown>;
    const edgeSources = { ...fallback.edgeSources };
    if (typeof o.edgeSources === "object" && o.edgeSources !== null) {
      for (const s of EDGE_SOURCE_INFO) {
        const on = (o.edgeSources as Record<string, unknown>)[s.id];
        if (typeof on === "boolean") edgeSources[s.id] = on;
      }
    }
    return {
      edgeSources,
      showAutoTags:
        typeof o.showAutoTags === "boolean"
          ? o.showAutoTags
          : fallback.showAutoTags,
      showOrphans:
        typeof o.showOrphans === "boolean"
          ? o.showOrphans
          : fallback.showOrphans,
    };
  } catch {
    return fallback;
  }
}

export function useGraphOptions(): [
  VisibilityOptions,
  (patch: Partial<VisibilityOptions>) => void,
] {
  const [options, setOptions] = useState(() => {
    try {
      return parseGraphOptions(localStorage.getItem(GRAPH_OPTIONS_KEY));
    } catch {
      return defaultGraphOptions();
    }
  });
  const update = useCallback((patch: Partial<VisibilityOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(GRAPH_OPTIONS_KEY, JSON.stringify(next));
      } catch {
        /* storage may be full or disabled */
      }
      return next;
    });
  }, []);
  return [options, update];
}
