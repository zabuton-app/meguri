/**
 * Analysis on top of the auto-tagging engine: what the screen's suggestions
 * are computed from, and the file name cut into taggable parts that
 * the detail view shows. Pure; the library-wide parts are indexed by position
 * in the list of names the caller passes — the caller knows which file each
 * position is.
 *
 * Names are expected in NFC (the screen normalizes them once on load), so the
 * ranges reported here index straight into the string that is displayed.
 */
import {
  SPLIT_PATTERN,
  cleanTagName,
  isUsableTagName,
  stripExt,
  tagsForName,
  type CompiledEngine,
  type Range,
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
// Suggestions: frequent words of the names that no condition picks up yet.
// ---------------------------------------------------------------------------

export interface Candidate {
  /** Lowercased tag name. */
  key: string;
  name: string;
  /** File position → where in the name the word is. */
  files: Map<number, Range[]>;
  /** Spellings found in the names. */
  variants: string[];
  count: number;
}

/**
 * Plain ASCII words in the names that nothing produces as a tag — not a rule,
 * not a keyword — in at least `minFreq` files. What the conditions do produce
 * is theirs to apply (a scan, or a pass over the library), not a suggestion.
 * A folder rule's tag is no such thing: it says nothing of the name, and the
 * word may well be in other files' names.
 */
export function suggestCandidates(
  engine: CompiledEngine,
  names: readonly string[],
  opts: {
    minFreq: number;
    stop: ReadonlySet<string>;
  },
): Candidate[] {
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
    /** What a rule or a keyword gives this name; found once it is needed. */
    let named: Set<string> | null = null;
    for (const match of stripExt(name).matchAll(/[A-Za-z]{3,}/g)) {
      const word = match[0];
      const key = word.toLowerCase();
      if (opts.stop.has(key) || dictionary.has(key)) continue;
      named ??= new Set(tagsForName(engine, name).map((t) => t.toLowerCase()));
      if (named.has(key)) continue;
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
  const out: Candidate[] = [];
  for (const [key, entry] of frequent) {
    if (entry.files.size < opts.minFreq) continue;
    const texts = mostCommonFirst(entry.texts);
    if (!isUsableTagName(cleanTagName(texts[0]))) continue;
    out.push({
      key,
      name: texts[0],
      files: entry.files,
      variants: texts,
      count: entry.files.size,
    });
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
