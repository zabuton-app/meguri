import {
  AUTO_META_SOURCE,
  namespaceOfAutoMetaValue,
  parseQualifiedTagName,
  parseTagSearchToken,
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
};

const VALUE_KEYS: Record<string, TranslationKey> = {
  "dur:short": "tags.value.durShort",
  "dur:medium": "tags.value.durMedium",
  "dur:long": "tags.value.durLong",
  "orient:vertical": "tags.value.orientVertical",
  "orient:horizontal": "tags.value.orientHorizontal",
  "orient:square": "tags.value.orientSquare",
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

/**
 * Human-readable description of a `tag:` search token, or null when the token is
 * ordinary free text. Used for the tooltip on the chips the search box renders,
 * where the chip itself shows the raw token.
 *
 * A generated tag is usually written as its bare value ("long"), so the category
 * is recovered from the vocabulary; the qualified form is accepted too. A value
 * that belongs to no closed set — a manual tag, or a codec — reads as itself.
 */
export function searchTokenLabel(t: TFunc, token: string): string | null {
  const raw = parseTagSearchToken(token);
  if (raw === null) return null;
  const parsed = parseQualifiedTagName(raw);
  const namespace =
    parsed.namespace || namespaceOfAutoMetaValue(parsed.name) || "";
  return namespace
    ? tagHumanLabel(t, namespace, parsed.name)
    : `${t("media.tags")}: ${parsed.name}`;
}

/** Origin label for a tag. Unknown sources fall back to their raw name. */
export function tagSourceLabel(t: TFunc, source: string): string {
  if (source === "manual") return t("tags.source.manual");
  if (source === AUTO_META_SOURCE) return t("tags.source.autoMeta");
  return source;
}
