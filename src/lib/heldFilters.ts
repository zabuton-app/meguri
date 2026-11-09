import type { SearchQuery } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { describeConditions } from "./searchConditions";
import { compatibleBinFilters } from "./binFilters";

/** Inactive filters can retain both audio and visual choices without executing either. */
export function mergeHeldFilters(
  before: SearchQuery,
  after: SearchQuery,
): SearchQuery {
  return {
    ...before,
    ...after,
    ...(before.audio || after.audio
      ? { audio: { ...before.audio, ...after.audio } }
      : {}),
  };
}

function includesFilter(query: SearchQuery, patch: SearchQuery): boolean {
  return Object.entries(patch).every(([key, value]) => {
    if (key === "audio")
      return Object.entries(patch.audio ?? {}).every(
        ([field, entry]) =>
          query.audio?.[field as keyof NonNullable<SearchQuery["audio"]>] ===
          entry,
      );
    return (
      JSON.stringify(query[key as keyof SearchQuery]) === JSON.stringify(value)
    );
  });
}

export function heldFilterEntries(
  held: SearchQuery,
  base: SearchQuery,
  active: SearchQuery,
  t: TFunc,
) {
  const descriptors = [
    ...describeConditions({ ...held, kind: undefined, audio: undefined }, t),
    ...describeConditions({ kind: held.kind }, t),
    ...describeConditions({ kind: "audio", audio: held.audio }, t).filter(
      (entry) => entry.key.startsWith("audio."),
    ),
  ];
  return descriptors.flatMap((descriptor) => {
    const remaining = descriptor.clear(held);
    const patch: SearchQuery = {};
    for (const key of Object.keys(held) as (keyof SearchQuery)[]) {
      if (JSON.stringify(held[key]) === JSON.stringify(remaining[key]))
        continue;
      if (key === "audio") {
        const audio: NonNullable<SearchQuery["audio"]> = {};
        for (const field of Object.keys(
          held.audio ?? {},
        ) as (keyof typeof audio)[])
          if (held.audio?.[field] !== remaining.audio?.[field])
            Object.assign(audio, { [field]: held.audio?.[field] });
        patch.audio = audio;
        patch.kind = "audio";
      } else Object.assign(patch, { [key]: held[key] });
    }
    if (includesFilter(active, patch)) return [];
    const compatible = compatibleBinFilters(patch, base).applied;
    return [
      {
        key: descriptor.key,
        label: descriptor.label,
        patch,
        clear: descriptor.clear,
        available: includesFilter(compatible, patch),
      },
    ];
  });
}

/** Explicitly enabling a remembered filter also selects the media mode it needs. */
export function enableHeldFilter(
  active: SearchQuery,
  patch: SearchQuery,
): SearchQuery {
  const next: SearchQuery = { ...active, ...patch };
  if (patch.audio) {
    const audio = { ...active.audio };
    if (patch.audio.sampleRate != null) delete audio.sampleRateMatch;
    if (patch.audio.bitDepth != null) delete audio.bitDepthMatch;
    if (patch.audio.durationMin != null || patch.audio.durationMax != null) {
      delete audio.durationMin;
      delete audio.durationMax;
      delete audio.durationMatch;
    }
    next.audio = { ...audio, ...patch.audio };
  }
  if (patch.kind === "audio") delete next.resolution;
  else if (patch.kind) delete next.audio;
  if (patch.resolution && active.kind === "audio") {
    next.kind = "visual";
    delete next.audio;
  }
  if (patch.recent) {
    delete next.addedFrom;
    delete next.addedTo;
    delete next.btimeFrom;
    delete next.btimeTo;
  } else if (
    patch.addedFrom != null ||
    patch.addedTo != null ||
    patch.btimeFrom != null ||
    patch.btimeTo != null
  )
    delete next.recent;
  return next;
}

/** Whether a requested, remembered choice is still inactive. Kept independent
 * of translations so the query guard and feedback describe the same state. */
export function hasHeldFilters(
  held: SearchQuery,
  active: SearchQuery,
): boolean {
  return Object.entries(held).some(([key, value]) => {
    if (key === "sort" || key === "sortDir" || value == null) return false;
    if (key === "audio")
      return Object.entries(held.audio ?? {}).some(
        ([field, entry]) =>
          entry != null &&
          active.audio?.[field as keyof NonNullable<SearchQuery["audio"]>] !==
            entry,
      );
    return (
      JSON.stringify(active[key as keyof SearchQuery]) !== JSON.stringify(value)
    );
  });
}

export function filterFeedback(
  active: SearchQuery,
  held: SearchQuery,
  base: SearchQuery,
  t: TFunc,
) {
  const paused = heldFilterEntries(held, base, active, t);
  const conditions = describeConditions(active, t).filter(
    (entry) =>
      entry.key !== "sort" &&
      entry.key !== "folder" &&
      !entry.key.startsWith("allOf-"),
  );
  return {
    combination: conditions.length + paused.length > 1,
    paused: paused.map((entry) => entry.label),
  };
}
