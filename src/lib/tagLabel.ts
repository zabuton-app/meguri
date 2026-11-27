import {
  AUTO_META_SOURCE,
  namespaceOfAutoMetaValue,
  parseQualifiedTagName,
  parseNegatedSearchToken,
  parseSearchDirective,
  parseTagSearchToken,
  type NumericSearch,
  type SearchDirective,
} from "@shared/tags";
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";

/**
 * Human-readable labels for generated tags, used in tooltips and on the tag
 * management screen. Chips themselves show the raw qualified value so that what
 * the user clicks matches the filter badge that appears.
 *
 * Two tiers, both falling back to the raw string: namespaces translate, but tag
 * values only where the set is closed. `codec:*` comes from ffprobe and `res:*`
 * is already readable in any language, so both render raw — a fixed key table
 * would print a raw key the first time an unlisted codec appears.
 */

const NAMESPACE_KEYS: Record<string, TranslationKey> = {
  res: "tags.ns.res",
  dur: "tags.ns.dur",
  codec: "tags.ns.codec",
  orient: "tags.ns.orient",
  audio_quality: "tags.ns.quality",
  audio_ch: "tags.ns.ch",
  audio_tempo: "tags.ns.tempo",
  audio_bpm: "tags.ns.bpm",
  audio_key: "tags.ns.key",
  audio_camelot: "tags.ns.camelot",
  audio_genre: "tags.ns.genre",
  camera: "tags.ns.camera",
  lens: "tags.ns.lens",
};

const VALUE_KEYS: Record<string, TranslationKey> = {
  "dur:short": "tags.value.durShort",
  "dur:medium": "tags.value.durMedium",
  "dur:long": "tags.value.durLong",
  "orient:vertical": "tags.value.orientVertical",
  "orient:horizontal": "tags.value.orientHorizontal",
  "orient:square": "tags.value.orientSquare",
  "audio_quality:lossless": "tags.value.qualityLossless",
  "audio_quality:lossy": "tags.value.qualityLossy",
  "audio_quality:hires": "tags.value.qualityHires",
  "audio_ch:mono": "tags.value.chMono",
  "audio_ch:stereo": "tags.value.chStereo",
  "audio_ch:surround": "tags.value.chSurround",
  "audio_tempo:slow": "tags.value.tempoSlow",
  "audio_tempo:moderate": "tags.value.tempoModerate",
  "audio_tempo:fast": "tags.value.tempoFast",
};

/** Translated category name, or the raw namespace when it is not a known one. */
export function tagNamespaceLabel(t: TFunc, namespace: string): string {
  const key = NAMESPACE_KEYS[namespace];
  return key ? t(key) : namespace;
}

/** Translated value, or the raw name when the value set is open or unlisted. */
export function tagValueLabel(
  t: TFunc,
  namespace: string,
  name: string,
): string {
  const key = VALUE_KEYS[`${namespace}:${name}`];
  return key ? t(key) : name;
}

/** `Resolution: 4K` for a generated tag, the bare name for a manual one. */
export function tagHumanLabel(
  t: TFunc,
  namespace: string,
  name: string,
): string {
  if (!namespace) return name;
  return `${tagNamespaceLabel(t, namespace)}: ${tagValueLabel(t, namespace, name)}`;
}

const NUMERIC_CHIP_KEYS: Record<NumericSearch["field"], TranslationKey> = {
  size: "filter.sizeChip",
  duration: "filter.durationChip",
  width: "filter.widthChip",
  height: "filter.heightChip",
};

/**
 * What a directive other than `tag:` reads as: its field and value, `Hash:
 * 3fa9`, `Size: >1gb` (the comparison as typed). A `tag:` directive's label
 * depends on where it is shown, so each caller builds its own. Shared by the
 * chip's tooltip and the condition row, so the two read the same.
 */
export function directiveLabel(
  t: TFunc,
  d: Exclude<SearchDirective, { kind: "tag" }>,
): string {
  switch (d.kind) {
    case "hash":
      return `${t("filter.hashChip")}: ${d.value}`;
    case "ext":
      return `${t("filter.extChip")}: ${d.value}`;
    case "numeric":
      return `${t(NUMERIC_CHIP_KEYS[d.num.field])}: ${d.value}`;
    case "rating":
      return `${t("media.rating")}: ${d.value}`;
    case "favorite":
      // Unlike the favorite control's `♥ Favorites`: both can be on at once,
      // and each chip clears only its own.
      return `${t("favorite.chip")} (${d.prefix}:${d.value})`;
  }
}

/**
 * Human-readable description of a `tag:`, `hash:`, `ext:` or numeric search
 * token, or null when the token is ordinary free text. Used for the tooltip on
 * the chips the search box renders, where the chip itself shows the raw token.
 *
 * A generated tag is usually written as its bare value ("long"), so the category
 * is recovered from the vocabulary; the qualified form is accepted too. A value
 * that belongs to no closed set — a manual tag, or a codec — reads as itself.
 * A negated directive (`-tag:beach`) reads as an exclusion of the same.
 */
export function searchTokenLabel(t: TFunc, raw: string): string | null {
  const { negated, body } = parseNegatedSearchToken(raw);
  const label = positiveTokenLabel(t, body);
  return label !== null && negated
    ? `${t("filter.excludeChip")}: ${label}`
    : label;
}

function positiveTokenLabel(t: TFunc, token: string): string | null {
  const d = parseSearchDirective(token);
  if (d === null) return null;
  if (d.kind !== "tag") return directiveLabel(t, d);
  const parsed = parseQualifiedTagName(d.value);
  const namespace =
    parsed.namespace || namespaceOfAutoMetaValue(parsed.name) || "";
  return namespace
    ? tagHumanLabel(t, namespace, parsed.name)
    : `${t("media.tags")}: ${parsed.name}`;
}

/**
 * What a search-box chip shows for a generated tag's token: its category and
 * value (`Tempo: Fast`) rather than `tag:audio_tempo:fast`. Null for anything
 * else, which shows as typed.
 */
export function generatedTagChipLabel(t: TFunc, token: string): string | null {
  const raw = parseTagSearchToken(token);
  if (raw === null) return null;
  const parsed = parseQualifiedTagName(raw);
  const namespace =
    parsed.namespace || namespaceOfAutoMetaValue(parsed.name) || "";
  return namespace ? tagHumanLabel(t, namespace, parsed.name) : null;
}

/** Origin label for a tag. Unknown sources fall back to their raw name. */
export function tagSourceLabel(t: TFunc, source: string): string {
  if (source === "manual") return t("tags.source.manual");
  if (source === AUTO_META_SOURCE) return t("tags.source.autoMeta");
  return source;
}
