/**
 * Tag naming contract, shared by both processes.
 *
 * A tag is `(namespace, name)`. An empty namespace means the tag is the user's
 * own — created by hand, freely renamed, merged and deleted. A non-empty
 * namespace means the tag is owned by a pipeline that rewrites it on every scan
 * (today: the metadata classifier); the user cannot edit those.
 *
 * The two forms are joined by a colon for display and for filter values:
 * `beach` for a manual tag, `res:4k` for a namespaced one.
 */

/** `meta_tags.source` written by the metadata classifier. */
export const AUTO_META_SOURCE = "auto-meta";

/**
 * Namespaces the metadata classifier emits, in the order the tag management
 * screen groups them. This is a presentation ordering hint and the v1 ruleset's
 * own vocabulary — never a matching rule. Namespaces are an open set: code that
 * decides tag *identity* resolves against the `tags` table instead (see
 * queries/files.ts).
 */
export const AUTO_META_NAMESPACES = ["res", "dur", "codec", "orient"] as const;
export type AutoMetaNamespace = (typeof AUTO_META_NAMESPACES)[number];

/**
 * The closed value sets of the classifier, declared once so a bare value can be
 * traced back to its category. `codec` is deliberately absent: its values come
 * from ffprobe and form an open set.
 *
 * These sets must stay disjoint — that is what lets the search box accept
 * `meta:long` instead of `meta:dur:long`. A ruleset test asserts both that they
 * do not overlap and that the classifier emits nothing outside them.
 */
export const AUTO_META_VALUES: Readonly<Record<string, readonly string[]>> = {
  res: ["4k", "1080p", "720p", "sd"],
  dur: ["short", "medium", "long"],
  orient: ["horizontal", "vertical", "square"],
};

/**
 * Which category a bare generated value belongs to, or null when it is a codec
 * (open set) or simply unknown. Presentation only — matching resolves against
 * the `tags` table.
 */
export function namespaceOfAutoMetaValue(value: string): string | null {
  const lower = value.toLowerCase();
  for (const [namespace, values] of Object.entries(AUTO_META_VALUES)) {
    if (values.includes(lower)) return namespace;
  }
  return null;
}

/**
 * Cap on tags returned by tags_list_all. Shared so the renderer's "showing top
 * N" notice always matches the actual server-side cut-off.
 */
export const MAX_TAG_LIST = 2000;

/**
 * Sources whose tags a list row neither carries nor draws — `attachTags` leaves
 * them out of FileRow, and the chip row filters again for rows that arrive from
 * a cache patch or a fixture. The detail view is unaffected and still shows
 * everything.
 *
 * Keyed by source rather than by namespace on purpose: the reason to hide is
 * "this source emits several low-information tags per file", not "this tag is
 * namespaced". A future source emitting a handful of meaningful tags shows up
 * unless it is added here deliberately.
 */
export const LIST_HIDDEN_SOURCES: readonly string[] = [AUTO_META_SOURCE];

export function isAutoMetaNamespace(ns: string): ns is AutoMetaNamespace {
  return (AUTO_META_NAMESPACES as readonly string[]).includes(ns);
}

/** Display and filter form: `beach` for a manual tag, `res:4k` for a namespaced one. */
export function qualifiedTagName(namespace: string, name: string): string {
  return namespace ? `${namespace}:${name}` : name;
}

/**
 * Inverse of {@link qualifiedTagName} — **for presentation only**.
 *
 * Used to label a `SearchQuery.tags[]` string that has no TagInfo behind it. It
 * splits only on a known auto-meta prefix, so a manual tag literally named
 * `todo:later` round-trips unchanged. A miss costs a label and nothing else:
 * matching never goes through here, it resolves against the `tags` table.
 */
export function parseQualifiedTagName(raw: string): {
  namespace: string;
  name: string;
} {
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return { namespace: "", name: raw };
  const namespace = raw.slice(0, i);
  return isAutoMetaNamespace(namespace)
    ? { namespace, name: raw.slice(i + 1) }
    : { namespace: "", name: raw };
}

/** Rename / merge / delete are allowed on user-owned tags only. */
export function isEditableTag(namespace: string): boolean {
  return namespace === "";
}

/**
 * Search-box directives that target a tag exactly instead of searching text:
 * `tag:beach` for a user's own tag, `meta:4k` / `meta:res:4k` for a generated
 * one.
 *
 * Generated tags are deliberately kept out of the full-text index — with a
 * trigram tokenizer, indexing `dur:long` would make a plain search for "long"
 * return every long video — so `meta:` is the only free-text route to them.
 * `tag:` exists so that clicking a tag can put the condition *in the search box*
 * without the exact match degrading into a substring search that also hits file
 * names.
 */
export const META_SEARCH_PREFIX = "meta";
export const TAG_SEARCH_PREFIX = "tag";

/** Prefixes a manual tag name may not claim: the namespaces plus the directives. */
export const RESERVED_TAG_PREFIXES: readonly string[] = [
  ...AUTO_META_NAMESPACES,
  META_SEARCH_PREFIX,
  TAG_SEARCH_PREFIX,
];

function parseDirective(token: string, prefix: string): string | null {
  const head = `${prefix}:`;
  if (!token.toLowerCase().startsWith(head)) return null;
  const value = token.slice(head.length).trim();
  return value || null;
}

/**
 * Extract the value of a `meta:` search token, or null when the token is
 * ordinary free text. `meta:` with nothing after it is ordinary text too.
 */
export function parseMetaSearchToken(token: string): string | null {
  return parseDirective(token, META_SEARCH_PREFIX);
}

/** Same for `tag:`, which targets the user's own tags. */
export function parseTagSearchToken(token: string): string | null {
  return parseDirective(token, TAG_SEARCH_PREFIX);
}

/** True for any token the search box treats as an exact-tag directive. */
export function isTagDirective(token: string): boolean {
  return (
    parseTagSearchToken(token) !== null || parseMetaSearchToken(token) !== null
  );
}

function needsQuoting(value: string): boolean {
  return /[\s"]/.test(value);
}

/**
 * The search-box token that reproduces this tag as an exact filter: `tag:` for
 * the user's own, `meta:` for a generated one.
 *
 * The generated form carries the **bare** value (`meta:long`, not
 * `meta:dur:long`): the category vocabularies are disjoint, so the value alone
 * is unambiguous and far easier to read and type. The qualified form stays
 * accepted on input as an escape hatch.
 *
 * Values containing whitespace or a quote are quoted, doubling any inner quote —
 * the same convention {@link splitSearchTokens} reads back.
 */
export function tagSearchToken(namespace: string, name: string): string {
  const prefix = namespace ? META_SEARCH_PREFIX : TAG_SEARCH_PREFIX;
  const body = needsQuoting(name) ? `"${name.replace(/"/g, '""')}"` : name;
  return `${prefix}:${body}`;
}

/**
 * Fold a directive typed with a space after the colon (`tag: beach`) back into
 * one token.
 *
 * A bare `tag:` is never a useful search term on its own, and leaving the value
 * behind as free text would quietly give the substring match over file names
 * that the directive exists to avoid — the one failure the user cannot see.
 */
function foldSpacedDirectives(tokens: string[]): string[] {
  const bare = [`${TAG_SEARCH_PREFIX}:`, `${META_SEARCH_PREFIX}:`];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (bare.includes(tokens[i].toLowerCase()) && i + 1 < tokens.length) {
      out.push(tokens[i] + tokens[i + 1]);
      i++;
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

/**
 * Split a search-box query into tokens on whitespace, keeping `"quoted phrases"`
 * together so a tag name with spaces survives as one token. `""` inside a quoted
 * run is a literal quote. An unterminated quote simply runs to the end.
 *
 * This is the one tokenizer both processes read a query through, so the space
 * tolerance in {@link foldSpacedDirectives} applies to the chips the search box
 * draws and to the SQL it produces alike — they can never disagree about what a
 * query means.
 */
export function splitSearchTokens(q: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quoted = false;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === '"') {
      if (quoted && q[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && /\s/.test(c)) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return foldSpacedDirectives(out);
}

/**
 * Whether the query ends inside an unterminated quoted run — i.e. the user is
 * still typing a phrase. The search box uses this to leave a token alone until
 * it is really closed, so a space typed inside `tag:"beach ` is not mistaken for
 * a token boundary. Mirrors the quote handling in {@link splitSearchTokens}.
 */
export function hasOpenQuote(q: string): boolean {
  let quoted = false;
  for (let i = 0; i < q.length; i++) {
    if (q[i] !== '"') continue;
    if (quoted && q[i + 1] === '"') {
      i++;
      continue;
    }
    quoted = !quoted;
  }
  return quoted;
}

/** Inverse of {@link splitSearchTokens}: re-quote what needs it and join. */
export function joinSearchTokens(tokens: string[]): string {
  return tokens
    .map((token) => {
      // A directive quotes only its value, so the prefix stays readable.
      for (const prefix of [TAG_SEARCH_PREFIX, META_SEARCH_PREFIX]) {
        const value = parseDirective(token, prefix);
        if (value !== null) {
          const body = needsQuoting(value)
            ? `"${value.replace(/"/g, '""')}"`
            : value;
          return `${prefix}:${body}`;
        }
      }
      return needsQuoting(token) ? `"${token.replace(/"/g, '""')}"` : token;
    })
    .join(" ");
}

/**
 * The reserved prefix a would-be manual tag name impersonates, or null when it
 * claims none. Returned rather than just tested so the rejection message can
 * name the prefix without re-deriving it — `parseQualifiedTagName()` cannot,
 * since it only splits on an auto-meta namespace and reads `meta:foo` as a
 * plain name.
 *
 * The reserved set is a parameter rather than a hardcoded list so widening it
 * (a second derived-tag source, user-defined namespaces) stays a one-liner.
 */
export function reservedTagPrefix(
  name: string,
  reserved: readonly string[] = RESERVED_TAG_PREFIXES,
): string | null {
  const i = name.indexOf(":");
  if (i <= 0 || i === name.length - 1) return null;
  const prefix = name.slice(0, i).toLowerCase();
  return reserved.includes(prefix) ? prefix : null;
}

export function isReservedTagName(
  name: string,
  reserved: readonly string[] = RESERVED_TAG_PREFIXES,
): boolean {
  return reservedTagPrefix(name, reserved) !== null;
}

/** Marker in the error a reserved-name rejection throws, so the renderer can
 *  tell it apart from a database failure without matching a whole sentence. */
export const RESERVED_TAG_ERROR = "reserved tag namespace";
