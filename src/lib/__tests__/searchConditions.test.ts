import { describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en";
import type { SearchQuery } from "@/ipc/types";
import {
  collapsedConditionCount,
  describeConditions,
  type ConditionDescriptor,
} from "@/lib/searchConditions";

const t = (key: keyof typeof en, params?: Record<string, string | number>) => {
  let s: string = en[key];
  if (params) {
    for (const [k, v] of Object.entries(params))
      s = s.replace(`{${k}}`, String(v));
  }
  return s;
};

const describe_ = (query: SearchQuery) => describeConditions(query, t);
const keys = (query: SearchQuery) => describe_(query).map((d) => d.key);
const find = (query: SearchQuery, key: string) =>
  describe_(query).find((d) => d.key === key) as ConditionDescriptor;

/** Apply every descriptor's clear in order, recomputing as the query shrinks. */
function clearEverything(query: SearchQuery): SearchQuery {
  let q = query;
  for (const d of describe_(q)) q = d.clear(q);
  return q;
}

const EVERYTHING: SearchQuery = {
  q: "sunset tag:beach",
  tags: ["holiday", "4k"],
  kind: "video",
  ratingMin: 3,
  favorite: true,
  played: false,
  btimeFrom: 1_700_000_000,
  btimeTo: 1_800_000_000,
  duplicates: true,
  sort: "name",
  sortDir: "desc",
};

describe("describeConditions", () => {
  it("returns nothing for a query with no conditions", () => {
    expect(describe_({})).toEqual([]);
    // Neutral values are not conditions either.
    expect(
      describe_({ q: "", tags: [], ratingMin: 0, favorite: false }),
    ).toEqual([]);
  });

  it("emits one descriptor per active condition in a stable order", () => {
    expect(keys(EVERYTHING)).toEqual([
      "q",
      "directive-1",
      "tag-0",
      "tag-1",
      "kind",
      "rating",
      "favorite",
      "played",
      "btime",
      "duplicates",
      "sort",
    ]);
  });

  it("groups primary-row conditions apart from collapsed ones", () => {
    const byKey = Object.fromEntries(
      describe_(EVERYTHING).map((d) => [d.key, d.group]),
    );
    expect(byKey).toMatchObject({
      q: "primary",
      "tag-0": "primary",
      kind: "primary",
      rating: "primary",
      favorite: "primary",
      played: "collapsed",
      btime: "collapsed",
      duplicates: "collapsed",
      sort: "collapsed",
    });
  });

  it("splits free text from the tag directives beside it", () => {
    // Both are conditions and both get a chip, but they are separate rows in the
    // list so each can be undone on its own.
    expect(keys({ q: "sunset tag:beach" })).toEqual(["q", "directive-1"]);
    expect(find({ q: "sunset tag:beach" }, "q").label).toBe('"sunset"');
    expect(find({ q: "sunset tag:beach" }, "directive-1").label).toBe(
      `${en["media.tags"]}: beach`,
    );
  });

  it("describes a directive-only query without a free-text chip", () => {
    expect(keys({ q: "tag:beach" })).toEqual(["directive-0"]);
  });

  it("keeps a quoted multi-word directive in one chip", () => {
    expect(find({ q: 'tag:"beach house"' }, "directive-0").label).toBe(
      `${en["media.tags"]}: beach house`,
    );
  });

  it("labels conditions with translated text", () => {
    expect(find({ kind: "video" }, "kind").label).toBe(en["kind.video"]);
    expect(find({ ratingMin: 4 }, "rating").label).toBe("★4+");
    expect(find({ played: true }, "played").label).toBe(en["filter.played"]);
    expect(find({ played: false }, "played").label).toBe(en["filter.unplayed"]);
    expect(find({ btimeFrom: 1_700_000_000 }, "btime").label).toContain(
      en["filter.btime"],
    );
  });
});

describe("sort", () => {
  it("is absent while the sort is the default", () => {
    expect(keys({})).not.toContain("sort");
  });

  it("appears once the key or the direction is set", () => {
    expect(keys({ sort: "name" })).toContain("sort");
    expect(keys({ sortDir: "asc" })).toContain("sort");
  });

  it("reaches both read-back surfaces", () => {
    // The badge says something is set; the chip is what says it is the sort,
    // without making the user open the panel to find out.
    const sort = find({ sort: "name" }, "sort");
    expect(sort.group).toBe("collapsed");
    expect(sort.chip).toBe(true);
  });

  it("names itself in the chip so it does not read as a narrowing filter", () => {
    expect(find({ sort: "name", sortDir: "asc" }, "sort").label).toBe(
      `${en["filter.sortSection"]}: ${en["sort.name"]} / ${en["sort.asc"]}`,
    );
  });
});

describe("clear reducers", () => {
  it("keeps tag directives when clearing free text", () => {
    const before: SearchQuery = { q: "sunset tag:beach" };
    expect(find(before, "q").clear(before)).toEqual({ q: "tag:beach" });
  });

  it("drops the query entirely when only free text was in it", () => {
    const before: SearchQuery = { q: "sunset", kind: "video" };
    expect(find(before, "q").clear(before)).toEqual({ kind: "video" });
  });

  it("removes one tag by value, so clearing several in a row hits the right ones", () => {
    // Index-based removal would shift the remaining entries and delete the wrong tag.
    const before: SearchQuery = { tags: ["a", "b", "c"] };
    expect(clearEverything(before)).toEqual({});
  });

  it("removes a tag directive whole, leaving the free text beside it", () => {
    const before: SearchQuery = { q: "sunset tag:beach tag:4k" };
    expect(find(before, "directive-1").clear(before)).toEqual({
      q: "sunset tag:4k",
    });
  });

  it("drops the query when the last directive is removed", () => {
    const before: SearchQuery = { q: "tag:beach" };
    expect(find(before, "directive-0").clear(before)).toEqual({});
  });

  it("clears both ends of a date range together", () => {
    const before: SearchQuery = { btimeFrom: 1, btimeTo: 2 };
    expect(find(before, "btime").clear(before)).toEqual({});
  });

  it("turns off the hash sort that the duplicates filter turned on", () => {
    const before: SearchQuery = { duplicates: true, sort: "hash" };
    expect(find(before, "duplicates").clear(before)).toEqual({});
  });

  it("is a no-op when duplicates is already off", () => {
    // The underlying patch is a toggle, so an unguarded clear would switch the
    // filter back on — and a non-idempotent reducer breaks any fold over the
    // descriptor list.
    const clear = find({ duplicates: true }, "duplicates").clear;
    expect(clear({ kind: "video" })).toEqual({ kind: "video" });
    expect(clear(clear({ duplicates: true }))).toEqual({});
  });

  it("drops keys instead of leaving them as explicit undefined", () => {
    // toEqual ignores undefined-valued keys, so this needs the strict form to
    // mean anything: the cleared query must not carry `kind: undefined`.
    const before: SearchQuery = { kind: "video", favorite: true };
    expect(find(before, "kind").clear(before)).toStrictEqual({
      favorite: true,
    });
  });

  it("shows an unrecognized kind verbatim rather than mislabelling it", () => {
    expect(find({ kind: "audio" }, "kind").label).toBe("audio");
  });

  it("leaves an explicitly chosen sort alone when duplicates is cleared", () => {
    const before: SearchQuery = { duplicates: true, sort: "name" };
    expect(find(before, "duplicates").clear(before)).toEqual({ sort: "name" });
  });

  it("clears only its own condition", () => {
    const all = describe_(EVERYTHING);
    for (const d of all) {
      // Compared by label, not by key: tag keys are positional, so removing the
      // first tag renumbers the second one without changing what it stands for.
      expect(describe_(d.clear(EVERYTHING)).map((x) => x.label)).toEqual(
        all.filter((x) => x.key !== d.key).map((x) => x.label),
      );
    }
  });

  it("never mutates its input", () => {
    const before = structuredClone(EVERYTHING);
    for (const d of describe_(EVERYTHING)) d.clear(EVERYTHING);
    expect(EVERYTHING).toEqual(before);
  });

  it("empties the query once every descriptor has been cleared", () => {
    expect(describe_(clearEverything(EVERYTHING))).toEqual([]);
  });
});

describe("collapsedConditionCount", () => {
  it("is zero when nothing is hidden", () => {
    expect(
      collapsedConditionCount(describe_({ kind: "video", favorite: true })),
    ).toBe(0);
  });

  it("counts only what lives inside the panel", () => {
    expect(collapsedConditionCount(describe_({ played: false }))).toBe(1);
    // Sort is not a chip, but it is hidden state, so it still counts.
    expect(
      collapsedConditionCount(describe_({ played: false, sort: "name" })),
    ).toBe(2);
    // Turning on duplicates also selects the hash sort, so two conditions are
    // genuinely active and the badge says so.
    expect(
      collapsedConditionCount(describe_({ duplicates: true, sort: "hash" })),
    ).toBe(2);
  });
});
