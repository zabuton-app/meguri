// The single derivation behind every read-back surface of the filter bar.
//
// A search query is a bag of optional fields; the bar needs to answer three
// questions about it — what is active, what is it called, and how do I undo just
// this one — plus a fourth once conditions collapse behind a panel: how many of
// them are currently out of sight. Deriving all four from one ordered list keeps
// them from drifting: a condition added here shows up in the chips, in the badge,
// and in "clear all" at once, instead of in whichever of the three the next
// change remembered to update.
import { resolveSortDir } from "@shared/sortDir";
import {
  isTagDirective,
  joinSearchTokens,
  parseQualifiedTagName,
  parseTagSearchToken,
  splitSearchTokens,
} from "@shared/tags";
import type { SearchQuery } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { toggleDuplicatesPatch } from "@/lib/duplicatesFilter";
import { describeDateRange } from "@/lib/smartCollections";
import { sortLabel } from "@/lib/sortLabel";
import { tagHumanLabel } from "@/lib/tagLabel";

/** Which surface owns the control that sets a condition. */
export type ConditionGroup = "primary" | "collapsed";

export interface ConditionDescriptor {
  /** Stable identity for React keys and test targeting. */
  key: string;
  /** Already-translated, human-readable text. */
  label: string;
  group: ConditionGroup;
  /** Whether the chip row renders it. */
  chip: boolean;
  /** Pure reducer returning the query with just this condition removed. */
  clear: (query: SearchQuery) => SearchQuery;
}

/** Drop a key rather than leaving it as an explicit `undefined` in the object. */
function without(query: SearchQuery, ...keys: (keyof SearchQuery)[]) {
  const next = { ...query };
  for (const key of keys) delete next[key];
  return next;
}

/** Human label for a tag, whether it came from `tags[]` or a `tag:` directive. */
function tagLabel(t: TFunc, raw: string): string {
  const { namespace, name } = parseQualifiedTagName(raw);
  return `${t("media.tags")}: ${tagHumanLabel(t, namespace, name)}`;
}

/**
 * Every active condition, in a stable order. Empty when nothing is filtering.
 *
 * Tag directives inside `q` (`tag:beach`) get a chip here even though the search
 * box already draws one of its own. It is a deliberate duplication: the row is
 * meant to be the complete answer to "what is narrowing this list", and a
 * condition that only appears inside another control is one the reader has to
 * know to go looking for.
 */
export function describeConditions(
  query: SearchQuery,
  t: TFunc,
): ConditionDescriptor[] {
  const out: ConditionDescriptor[] = [];

  const freeText = splitSearchTokens(query.q ?? "").filter(
    (token) => !isTagDirective(token),
  );
  if (freeText.length)
    out.push({
      key: "q",
      label: `"${joinSearchTokens(freeText)}"`,
      group: "primary",
      chip: true,
      clear: (q) => {
        const directives = splitSearchTokens(q.q ?? "").filter(isTagDirective);
        const rest = joinSearchTokens(directives);
        return rest ? { ...q, q: rest } : without(q, "q");
      },
    });

  splitSearchTokens(query.q ?? "").forEach((token, i) => {
    const tag = isTagDirective(token) ? parseTagSearchToken(token) : null;
    if (tag == null) return;
    out.push({
      key: `directive-${i}`,
      label: tagLabel(t, tag),
      group: "primary",
      chip: true,
      // Matched by token text, so the directive is removed whole — a partial
      // edit would leave `tag:bea` behind as a substring search.
      clear: (q) => {
        const rest = splitSearchTokens(q.q ?? "").filter(
          (tok) => tok !== token,
        );
        const joined = joinSearchTokens(rest);
        return joined ? { ...q, q: joined } : without(q, "q");
      },
    });
  });

  (query.tags ?? []).forEach((tag, i) => {
    out.push({
      key: `tag-${i}`,
      label: tagLabel(t, tag),
      group: "primary",
      chip: true,
      // Matched by value, not by index: clearing several tags in sequence would
      // otherwise shift the ones behind it and remove the wrong entry.
      clear: (q) => {
        const rest = (q.tags ?? []).filter((v) => v !== tag);
        return rest.length ? { ...q, tags: rest } : without(q, "tags");
      },
    });
  });

  if (query.kind)
    out.push({
      key: "kind",
      // `kind` is a plain string in the schema, so a saved search can carry a
      // value the UI has no label for. Show it verbatim rather than mislabel it.
      label:
        query.kind === "video"
          ? t("kind.video")
          : query.kind === "image"
            ? t("kind.image")
            : query.kind,
      group: "primary",
      chip: true,
      clear: (q) => without(q, "kind"),
    });

  if (query.ratingMin)
    out.push({
      key: "rating",
      label: `★${query.ratingMin}+`,
      group: "primary",
      chip: true,
      clear: (q) => without(q, "ratingMin"),
    });

  if (query.favorite)
    out.push({
      key: "favorite",
      label: `♥ ${t("favorite.chip")}`,
      group: "primary",
      chip: true,
      clear: (q) => without(q, "favorite"),
    });

  if (query.played != null)
    out.push({
      key: "played",
      label: query.played ? t("filter.played") : t("filter.unplayed"),
      group: "collapsed",
      chip: true,
      clear: (q) => without(q, "played"),
    });

  if (query.btimeFrom != null || query.btimeTo != null)
    out.push({
      key: "btime",
      label: `${t("filter.btime")}: ${describeDateRange(t, query.btimeFrom, query.btimeTo)}`,
      group: "collapsed",
      chip: true,
      clear: (q) => without(q, "btimeFrom", "btimeTo"),
    });

  if (query.duplicates)
    out.push({
      key: "duplicates",
      label: t("duplicates.chip"),
      group: "collapsed",
      chip: true,
      // Through the shared patch so the hash sort it turns on is turned back off
      // with it, exactly as the toggle in the panel does. That patch is a
      // *toggle*, so it has to be guarded: called on a query where duplicates is
      // already off it would switch the filter back on, and a clear reducer that
      // is not idempotent breaks the moment descriptors are folded in sequence.
      clear: (q) => {
        if (!q.duplicates) return q;
        const patch = toggleDuplicatesPatch(q);
        const next = { ...q, ...patch };
        return without(
          next,
          ...(Object.keys(patch) as (keyof SearchQuery)[]).filter(
            (key) => patch[key] === undefined,
          ),
        );
      },
    });

  // Not a narrowing condition, but it is hidden state once the control moves
  // into the panel. The badge alone would only say that *something* is set; the
  // chip is what names it without making the user open the panel to find out.
  if (query.sort || query.sortDir) {
    const sort = query.sort ?? "added";
    const dir = resolveSortDir(sort, query.sortDir);
    out.push({
      key: "sort",
      label: `${t("filter.sortSection")}: ${sortLabel(t, sort)} / ${t(dir === "asc" ? "sort.asc" : "sort.desc")}`,
      group: "collapsed",
      chip: true,
      clear: (q) => without(q, "sort", "sortDir"),
    });
  }

  return out;
}

/** How many active conditions live inside the collapsed panel. */
export function collapsedConditionCount(
  descriptors: ConditionDescriptor[],
): number {
  return descriptors.filter((d) => d.group === "collapsed").length;
}
