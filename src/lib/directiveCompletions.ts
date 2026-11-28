// What the command menu offers for search directives (#730): each kind's
// prefixes while a word is typed, and its values where they are a fixed few.
// One record keyed by the directive's kind, so a new kind of directive does
// not compile until what it offers is decided.
import {
  EXT_SEARCH_PREFIX,
  FAVORITE_SEARCH_VALUE,
  HASH_SEARCH_PREFIX,
  IS_SEARCH_PREFIX,
  NUMERIC_SEARCH_FIELDS,
  RATING_SEARCH_PREFIX,
  SEARCH_NOT,
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  parseNegatedSearchToken,
  splitSearchTokens,
  type NumericSearchField,
  type SearchDirective,
} from "@shared/tags";
import {
  HAS_NOTE_VALUE,
  HAS_SEARCH_PREFIX,
  NOTE_SEARCH_PREFIX,
} from "@shared/noteSearch";
import type { TranslationKey } from "@/i18n/locales/ja";

export interface DirectiveCompletion {
  /** Typed before the colon. */
  prefix: string;
  /** What the prefix reads as in the list: its chip's label. */
  label: TranslationKey;
  /** The values offered after the colon, when they are a fixed few (or, for
   *  an open number, a few common ones, #733). */
  values?: readonly string[];
  /** Offered instead while nothing follows the colon, when `values` are
   *  too many to list at once (#732). */
  initial?: readonly string[];
  /** Where the values come from when the library holds them (#731). */
  catalog?: Catalog;
  /** Offered after a typed number instead, appended to it, first the one
   *  Enter should take (#733). */
  units?: readonly string[];
}

/** The lists of values read from the library, by what they complete. */
export type Catalog = "ext";

/** How many values read from the library are offered at once. */
const MAX_CATALOG_VALUES = 10;

// A few common conditions, which also show how each is written, and the units
// a typed number can take (#733). MB first, since few mean bytes. `width:` and
// `height:` compare one edge each, unlike the resolution tags (longer edge).
const NUMERIC_COMPLETIONS: Record<
  NumericSearchField,
  Omit<DirectiveCompletion, "prefix">
> = {
  size: {
    label: "filter.sizeChip",
    values: [">1gb", ">100mb", "<1mb"],
    units: ["mb", "gb", "kb"],
  },
  duration: {
    label: "filter.durationChip",
    values: ["<30s", ">10m", ">1h"],
    units: ["s", "m", "h"],
  },
  width: { label: "filter.widthChip", values: [">=1920", ">=1280"] },
  height: { label: "filter.heightChip", values: [">=1080", ">=720"] },
};

// Every `rating:` condition but `>5` and `<0`, which match no file, and `>=0`
// and `<=5`, which match every file (#732). Grouped by comparison, so typing
// one (`rating:>=`) lists its values in order.
const RATING_VALUES = [
  ...[5, 4, 3, 2, 1].map((n) => `>=${n}`),
  ...[4, 3, 2, 1, 0].map((n) => `>${n}`),
  ...[0, 1, 2, 3, 4].map((n) => `<=${n}`),
  ...[1, 2, 3, 4, 5].map((n) => `<${n}`),
  ...[0, 1, 2, 3, 4, 5].map(String),
];

export const DIRECTIVE_COMPLETIONS: Record<
  SearchDirective["kind"],
  readonly DirectiveCompletion[]
> = {
  tag: [{ prefix: TAG_SEARCH_PREFIX, label: "media.tags" }],
  hash: [{ prefix: HASH_SEARCH_PREFIX, label: "filter.hashChip" }],
  ext: [{ prefix: EXT_SEARCH_PREFIX, label: "filter.extChip", catalog: "ext" }],
  numeric: NUMERIC_SEARCH_FIELDS.map((field) => ({
    prefix: field,
    ...NUMERIC_COMPLETIONS[field],
  })),
  rating: [
    {
      prefix: RATING_SEARCH_PREFIX,
      label: "media.rating",
      values: RATING_VALUES,
      initial: [">=4", ">=3", "5", "0", "<=2"],
    },
  ],
  favorite: [
    {
      prefix: IS_SEARCH_PREFIX,
      label: "favorite.chip",
      values: [FAVORITE_SEARCH_VALUE],
    },
  ],
  note: [{ prefix: NOTE_SEARCH_PREFIX, label: "media.note" }],
  hasNote: [
    {
      prefix: HAS_SEARCH_PREFIX,
      label: "filter.hasNote",
      values: [HAS_NOTE_VALUE],
    },
  ],
};

const ALL = Object.values(DIRECTIVE_COMPLETIONS).flat();

/**
 * The command menu's own prefixes, which open a page rather than filter
 * (`ws:` a workspace, `col:` a collection). They open it only from the start
 * of the field, so they are offered for a word alone in it.
 */
const PAGE_PREFIXES = [
  { prefix: "ws", label: "filter.prefixWorkspace", page: "ws" },
  { prefix: "col", label: "filter.prefixCollection", page: "col" },
] as const satisfies readonly {
  prefix: string;
  label: TranslationKey;
  page: string;
}[];

/** The token being typed at the end of the draft, or null once it is closed. */
function typedTail(draft: string): string | null {
  if (/\s$/.test(draft) || hasOpenQuote(draft)) return null;
  return splitSearchTokens(draft).at(-1) ?? null;
}

/** The directive being typed at the end of the draft, split at its colon. */
function typedDirective(draft: string): {
  entry: DirectiveCompletion;
  negated: boolean;
  partial: string;
} | null {
  const tail = typedTail(draft);
  if (tail === null) return null;
  const { negated, body } = parseNegatedSearchToken(tail);
  const typed = body.toLowerCase();
  const colon = typed.indexOf(":");
  if (colon < 0) return null;
  const prefix = typed.slice(0, colon);
  const entry = ALL.find((c) => c.prefix === prefix);
  return entry ? { entry, negated, partial: typed.slice(colon + 1) } : null;
}

/**
 * Which list from the library the directive at the end of the draft needs for
 * its values (`ext:` the extensions), so it is read only then; null otherwise.
 */
export function catalogWanted(draft: string): Catalog | null {
  return typedDirective(draft)?.entry.catalog ?? null;
}

/**
 * The values the directive at the end of the draft can take, from what is
 * typed after its colon (`has:` and `has:n` offer `has:note`), negated when it
 * is. A directive whose values the library holds takes them from `catalogs`,
 * in the order given, at most MAX_CATALOG_VALUES.
 */
export function valueSuggestions(
  draft: string,
  catalogs: Partial<Record<Catalog, readonly string[]>> = {},
): string[] {
  const typed = typedDirective(draft);
  if (typed === null) return [];
  const { entry, negated } = typed;
  // `ext:` reads `.mp4` as `mp4` (parseExtSearchToken), so a dot narrows alike.
  const partial =
    entry.catalog === "ext" ? typed.partial.replace(/^\./, "") : typed.partial;
  // A number typed after any comparison (`>500`) is offered with each unit;
  // a partly typed unit then narrows them below.
  const number = entry.units && /^(?:>=|<=|>|<)?\d+(?:\.\d+)?/.exec(partial);
  const values = number
    ? entry.units?.map((unit) => `${number[0]}${unit}`)
    : ((partial === "" ? entry.initial : undefined) ??
      entry.values ??
      (entry.catalog ? catalogs[entry.catalog] : []));
  const not = negated ? SEARCH_NOT : "";
  return (values ?? [])
    .filter((value) => value.startsWith(partial))
    .slice(0, entry.catalog ? MAX_CATALOG_VALUES : undefined)
    .map((value) => `${not}${entry.prefix}:${value}`);
}

export interface PrefixSuggestion {
  /** What picking it puts in the field: the prefix and its colon. */
  token: string;
  label: TranslationKey;
  /** For `ws:` and `col:`: the page picking it opens. */
  page?: (typeof PAGE_PREFIXES)[number]["page"];
}

/**
 * The prefixes the word at the end of the draft begins (`ra` offers
 * `rating:`), negated after a leading `-`. From two characters, as a word
 * offers tags: prefixes are ASCII words, and one letter would offer half of
 * them.
 */
export function prefixSuggestions(draft: string): PrefixSuggestion[] {
  const tail = typedTail(draft);
  if (tail === null) return [];
  const { negated, body } = parseNegatedSearchToken(tail);
  if (body.includes(":") || body.includes("|")) return [];
  const word = body.toLowerCase();
  if (word.length < 2) return [];
  const not = negated ? SEARCH_NOT : "";
  const directives: PrefixSuggestion[] = ALL.filter((c) =>
    c.prefix.startsWith(word),
  ).map((c) => ({ token: `${not}${c.prefix}:`, label: c.label }));
  const alone = splitSearchTokens(draft).length === 1;
  const pages: PrefixSuggestion[] =
    negated || !alone
      ? []
      : PAGE_PREFIXES.filter((p) => p.prefix.startsWith(word)).map((p) => ({
          token: `${p.prefix}:`,
          label: p.label,
          page: p.page,
        }));
  return [...directives, ...pages];
}
