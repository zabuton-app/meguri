/**
 * Analysis on top of the auto-tagging engine: what the screen's suggestions
 * are computed from, and the file name cut into taggable parts that
 * the detail view shows. Pure; the library-wide parts are indexed by position
 * in the list of names the caller passes (and of places, for the folder rules)
 * — the caller knows which file each position is.
 *
 * Names are expected in NFC (the screen normalizes them once on load), so the
 * ranges reported here index straight into the string that is displayed.
 */
import {
  SPLIT_PATTERN,
  cleanTagName,
  folderMatcher,
  isUsableTagName,
  runKeyword,
  runRule,
  stripExt,
  tagsForName,
  withFolderTags,
  type CompiledEngine,
  type FilePlace,
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

export type CandidateOrigin = RuleKind | "keyword" | "folder" | "frequent";

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

const NO_RANGES: Range[] = [];
const NO_TEXTS: string[] = [];

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
  opts: {
    minFreq: number;
    stop: ReadonlySet<string>;
    /**
     * Where each file is, by position, for the engine's folder rules. Without
     * it they propose nothing: a name alone does not say where its file is.
     */
    places?: readonly FilePlace[];
  },
): Candidate[] {
  const map = new Map<string, CandidateDraft>();
  const reaching = folderMatcher(engine.folders);
  /** Tags the names give, through a rule or a keyword. */
  const named = new Set<string>();
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
    if (origin !== "folder" && origin !== "frequent") named.add(key);
    for (const text of texts) c.variants.add(text);
    const have = c.files.get(file);
    if (have) have.push(...ranges);
    // Nothing to copy for a tag that points at no part of the name: one
    // shared list serves every such file.
    else c.files.set(file, ranges.length > 0 ? [...ranges] : NO_RANGES);
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
    // What the folder rules reaching the file give it — exactly what a scan
    // would add after the name's own tags (withFolderTags), so a tag the name
    // already gave is not listed again as the folder's. A folder rule points
    // at no part of the name: no range, no spelling.
    const place = opts.places?.[i];
    if (place) {
      const folders = reaching(place);
      if (folders.length > 0) {
        const named = tagsForName(engine, name);
        for (const tag of withFolderTags(named, folders).slice(named.length)) {
          add(tag, "folder", i, NO_RANGES, NO_TEXTS);
        }
      }
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
      // What a rule or a keyword already produces is not a word nothing
      // picks up. A folder rule's tag is no such thing: it says nothing of
      // the name, and the word may well be in other files' names.
      if (opts.stop.has(key) || dictionary.has(key) || named.has(key)) continue;
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
// A file name cut into clickable tokens (the detail view's "from the file
// name" row).
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

/** SPLIT_PATTERN, capturing: `split` keeps the separators it cuts at. */
const SPLIT_PIECES = new RegExp(`(${SPLIT_PATTERN.source})`);

/** Punctuation around a word — `Trip,` `(2019)` `#live` — is not part of its tag. */
const TAG_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** One stretch of a file name: plain text, or text that stands for a tag. */
export interface NameTagPart {
  text: string;
  /** The tag clicking it adds; null for separators and unusable names. */
  tag: string | null;
}

/**
 * A file name as the parts it can be tagged from: each word, a code's prefix
 * (`ABCD-123` → `ABCD`), and each entry inside a pair of brackets
 * (`[Trip, Family]` → `Trip`, `Family`). The texts join back to the name.
 */
export function nameTagParts(name: string): NameTagPart[] {
  // Nothing is offered for a part with no letter or digit in it (the dash of
  // `Artist - Title`): what is left after the edges are trimmed is empty.
  const tagOf = (raw: string): string | null => {
    const tag = cleanTagName(raw.replace(TAG_EDGES, ""));
    return isUsableTagName(tag) ? tag : null;
  };
  const out: NameTagPart[] = [];
  for (const token of tokenizeName(name)) {
    if (token.sep) {
      out.push({ text: token.text, tag: null });
      continue;
    }
    const info = tokenInfo(token.text);
    if (info.type !== "bracket") {
      // Read without the punctuation around it, so that `(ABCD-123)` is the
      // code it is: tagged by its prefix like a bare one.
      const bare = tokenInfo(token.text.replace(TAG_EDGES, ""));
      out.push({ text: token.text, tag: tagOf(bare.value) });
      continue;
    }
    // The brackets and the separators between entries stay as plain text.
    out.push({ text: token.text[0], tag: null });
    for (const piece of info.value.split(SPLIT_PIECES)) {
      if (piece === "") continue;
      const entry = piece.trim();
      if (entry === "" || SPLIT_PATTERN.test(piece)) {
        out.push({ text: piece, tag: null });
        continue;
      }
      // Spaces around an entry belong to the separator, not to the tag.
      const lead = piece.length - piece.trimStart().length;
      if (lead > 0) out.push({ text: piece.slice(0, lead), tag: null });
      out.push({ text: entry, tag: tagOf(entry) });
      const tail = piece.slice(lead + entry.length);
      if (tail) out.push({ text: tail, tag: null });
    }
    out.push({ text: token.text[token.text.length - 1], tag: null });
  }
  return out;
}
