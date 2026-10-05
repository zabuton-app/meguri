/**
 * Library-wide analysis on top of the auto-tagging engine: what the screen's
 * suggestion, review and term views are computed from. Pure, and indexed by
 * position in the list of names the caller passes — the caller knows which file
 * each position is.
 *
 * Names are expected in NFC (the screen normalizes them once on load), so the
 * ranges reported here index straight into the string that is displayed.
 */
import {
  PREFIX_PATTERN,
  SPLIT_PATTERN,
  cleanTagName,
  isUsableTagName,
  runKeyword,
  runRule,
  stripExt,
  type CompiledEngine,
  type Range,
  type RuleKind,
} from "./autoTag.js";

/** Words that say nothing about a file. The user's excluded terms add to these. */
export const STOP_WORDS: readonly string[] = [
  "the",
  "and",
  "with",
  "for",
  "from",
  "vol",
  "part",
  "new",
  "copy",
  "final",
  "img",
  "dsc",
  "mvi",
  "mov",
  "vid",
  "pxl",
  "gopr",
  "screenshot",
];

export interface Segment {
  text: string;
  /** `hit`: highlighted. `muted`: matched but produced nothing (struck through). */
  kind: "plain" | "hit" | "muted";
}

/** Cut a name into plain and highlighted runs. Overlapping ranges keep the first. */
export function segments(
  name: string,
  ranges: readonly (Range & { muted?: boolean })[],
): Segment[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const r of sorted) {
    if (r.start < pos) continue;
    if (r.start > pos)
      out.push({ text: name.slice(pos, r.start), kind: "plain" });
    out.push({
      text: name.slice(r.start, r.end),
      kind: r.muted ? "muted" : "hit",
    });
    pos = r.end;
  }
  if (pos < name.length) out.push({ text: name.slice(pos), kind: "plain" });
  return out;
}

// ---------------------------------------------------------------------------
// Suggestions: every tag the engine would give, plus frequent words it misses.
// ---------------------------------------------------------------------------

export type CandidateOrigin = RuleKind | "keyword" | "frequent";

export interface Candidate {
  /** Lowercased tag name. */
  key: string;
  name: string;
  origins: CandidateOrigin[];
  /** File position → where in the name the tag comes from. */
  files: Map<number, Range[]>;
  /** Spellings found in the names. */
  variants: string[];
  count: number;
}

export type CandidateGroup = "rule" | "keyword" | "frequent";

export function candidateGroup(c: Candidate): CandidateGroup {
  if (c.origins.includes("frequent")) return "frequent";
  return c.origins.includes("keyword") ? "keyword" : "rule";
}

interface CandidateDraft {
  key: string;
  name: string;
  origins: Set<CandidateOrigin>;
  files: Map<number, Range[]>;
  variants: Set<string>;
}

export function suggestCandidates(
  engine: CompiledEngine,
  names: readonly string[],
  opts: { minFreq: number; stop: ReadonlySet<string> },
): Candidate[] {
  const map = new Map<string, CandidateDraft>();
  const add = (
    name: string,
    origin: CandidateOrigin,
    file: number,
    ranges: Range[],
    texts: Iterable<string>,
  ): void => {
    const key = name.toLowerCase();
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        name,
        origins: new Set(),
        files: new Map(),
        variants: new Set(),
      };
      map.set(key, c);
    }
    c.origins.add(origin);
    for (const text of texts) c.variants.add(text);
    const have = c.files.get(file);
    if (have) have.push(...ranges);
    else c.files.set(file, [...ranges]);
  };

  names.forEach((name, i) => {
    for (const compiled of engine.rules) {
      for (const hit of runRule(compiled, name)) {
        for (const tag of hit.tags) {
          add(tag, compiled.rule.kind, i, [hit], [tag]);
        }
      }
    }
    for (const compiled of engine.keywords) {
      const hits = runKeyword(compiled, name);
      if (hits.length === 0) continue;
      add(
        compiled.tag,
        "keyword",
        i,
        hits,
        hits.map((h) => h.text),
      );
    }
  });

  // Frequent words: plain ASCII words nothing above picked up.
  const dictionary = new Set<string>();
  for (const { entry } of engine.keywords) {
    for (const term of [entry.tag, ...entry.aliases]) {
      dictionary.add(term.toLowerCase());
    }
  }
  const frequent = new Map<
    string,
    { texts: Map<string, number>; files: Map<number, Range[]> }
  >();
  names.forEach((name, i) => {
    for (const match of stripExt(name).matchAll(/[A-Za-z]{3,}/g)) {
      const word = match[0];
      const key = word.toLowerCase();
      if (opts.stop.has(key) || dictionary.has(key) || map.has(key)) continue;
      let entry = frequent.get(key);
      if (!entry) {
        entry = { texts: new Map(), files: new Map() };
        frequent.set(key, entry);
      }
      entry.texts.set(word, (entry.texts.get(word) ?? 0) + 1);
      const range = { start: match.index, end: match.index + word.length };
      const have = entry.files.get(i);
      if (have) have.push(range);
      else entry.files.set(i, [range]);
    }
  });
  for (const entry of frequent.values()) {
    if (entry.files.size < opts.minFreq) continue;
    const texts = mostCommonFirst(entry.texts);
    if (!isUsableTagName(cleanTagName(texts[0]))) continue;
    for (const [file, ranges] of entry.files) {
      add(texts[0], "frequent", file, ranges, texts);
    }
  }

  return [...map.values()]
    .map((c) => ({
      key: c.key,
      name: c.name,
      origins: [...c.origins],
      files: c.files,
      variants: [...c.variants],
      count: c.files.size,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function mostCommonFirst(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([text]) => text);
}

// ---------------------------------------------------------------------------
// Review: a file name cut into clickable tokens.
// ---------------------------------------------------------------------------

export interface NameToken {
  text: string;
  /** Separators (spaces, underscores, the extension) are shown but not clickable. */
  sep: boolean;
}

const TOKEN_PATTERN =
  /\[[^\]]+\]|【[^】]+】|「[^」]+」|[A-Za-z]{2,6}-\d{2,5}|[^\s_[\]【】「」]+/g;

export function tokenizeName(name: string): NameToken[] {
  const base = stripExt(name);
  const out: NameToken[] = [];
  let pos = 0;
  for (const match of base.matchAll(TOKEN_PATTERN)) {
    if (match.index > pos) {
      out.push({ text: base.slice(pos, match.index), sep: true });
    }
    out.push({ text: match[0], sep: false });
    pos = match.index + match[0].length;
  }
  if (pos < base.length) out.push({ text: base.slice(pos), sep: true });
  if (name.length > base.length) {
    out.push({ text: name.slice(base.length), sep: true });
  }
  return out;
}

export type BracketKind = "square" | "sumi" | "kagi";

export const BRACKET_PATTERNS: Record<BracketKind, string> = {
  square: "\\[([^\\]]+)\\]",
  sumi: "【([^】]+)】",
  kagi: "「([^」]+)」",
};

export type TokenInfo =
  | { type: "bracket"; bracket: BracketKind; value: string }
  | { type: "code"; value: string }
  | { type: "word"; value: string };

const BRACKET_OF: Record<string, BracketKind> = {
  "[": "square",
  "【": "sumi",
  "「": "kagi",
};

export function tokenInfo(text: string): TokenInfo {
  const bracket = BRACKET_OF[text[0]];
  if (bracket && text.length > 2) {
    return { type: "bracket", bracket, value: text.slice(1, -1) };
  }
  const code = /^([A-Za-z]{2,6})-\d+$/.exec(text);
  if (code) return { type: "code", value: code[1] };
  return { type: "word", value: text };
}

/** The tag values a token stands for, lowercased. */
export function tokenValues(info: TokenInfo): string[] {
  const parts =
    info.type === "bracket" ? info.value.split(SPLIT_PATTERN) : [info.value];
  return parts.map((p) => p.trim().toLowerCase()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Terms: every candidate word in the library, to be sorted into tags.
// ---------------------------------------------------------------------------

export const TERM_TYPES = ["code", "bracket", "word", "ja"] as const;
export type TermType = (typeof TERM_TYPES)[number];

export interface Term {
  /** Lowercased text. */
  key: string;
  type: TermType;
  /** The most common spelling. */
  display: string;
  variants: string[];
  files: Map<number, Range[]>;
  count: number;
}

const PREFIX_AT_START = new RegExp(PREFIX_PATTERN.replace("[A-Z]", "[A-Za-z]"));
const BRACKET_SCANS = Object.values(BRACKET_PATTERNS);
const JAPANESE_RUN = /[぀-ヿ一-鿿]{2,}/g;

export function extractTerms(
  names: readonly string[],
  stop: ReadonlySet<string>,
): Term[] {
  const map = new Map<
    string,
    { type: TermType; texts: Map<string, number>; files: Map<number, Range[]> }
  >();
  const add = (text: string, type: TermType, file: number, range: Range) => {
    const key = text.toLowerCase();
    let term = map.get(key);
    if (!term) {
      term = { type, texts: new Map(), files: new Map() };
      map.set(key, term);
    }
    term.texts.set(text, (term.texts.get(text) ?? 0) + 1);
    const have = term.files.get(file);
    if (have) have.push(range);
    else term.files.set(file, [range]);
  };

  names.forEach((name, i) => {
    const base = stripExt(name);
    const taken: Range[] = [];
    const free = (start: number, end: number): boolean =>
      !taken.some((r) => start < r.end && end > r.start);

    const code = PREFIX_AT_START.exec(base);
    if (code) {
      add(code[1], "code", i, { start: 0, end: code[1].length });
      taken.push({ start: 0, end: code[0].length });
    }
    for (const source of BRACKET_SCANS) {
      for (const match of base.matchAll(new RegExp(source, "g"))) {
        const range = {
          start: match.index,
          end: match.index + match[0].length,
        };
        taken.push(range);
        for (const part of match[1].split(SPLIT_PATTERN)) {
          const value = part.trim();
          if (value) add(value, "bracket", i, range);
        }
      }
    }
    for (const match of base.matchAll(/[A-Za-z]{3,}/g)) {
      const end = match.index + match[0].length;
      if (free(match.index, end) && !stop.has(match[0].toLowerCase())) {
        add(match[0], "word", i, { start: match.index, end });
      }
    }
    for (const match of base.matchAll(JAPANESE_RUN)) {
      const end = match.index + match[0].length;
      if (free(match.index, end)) {
        add(match[0], "ja", i, { start: match.index, end });
      }
    }
  });

  return [...map.entries()]
    .map(([key, term]) => {
      const variants = mostCommonFirst(term.texts);
      return {
        key,
        type: term.type,
        display: variants[0],
        variants,
        files: term.files,
        count: term.files.size,
      };
    })
    .filter((term) => isUsableTagName(cleanTagName(term.display)))
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
}
