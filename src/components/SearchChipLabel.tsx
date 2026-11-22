import {
  EXT_SEARCH_PREFIX,
  FAVORITE_SEARCH_VALUE,
  HASH_SEARCH_PREFIX,
  IS_SEARCH_PREFIX,
  RATING_SEARCH_PREFIX,
  TAG_SEARCH_PREFIX,
  isFavoriteSearchToken,
  parseExtSearchToken,
  parseHashSearchToken,
  parseRatingSearchToken,
  parseTagSearchToken,
  ratingSearchText,
} from "@shared/tags";
import type { TFunc } from "@/i18n/I18nProvider";
import { generatedTagChipLabel } from "@/lib/tagLabel";

/** What a search chip reads: `tag:beach`, or a generated tag's `Tempo: Fast`. */
export function SearchChipLabel({ t, token }: { t: TFunc; token: string }) {
  const [prefix, body] = directiveParts(token);
  const human =
    prefix === TAG_SEARCH_PREFIX ? generatedTagChipLabel(t, token) : null;
  return (
    <span className="truncate">
      {human ?? (
        <>
          <span className="text-muted">{prefix}:</span>
          {body}
        </>
      )}
    </span>
  );
}

/** A directive's prefix and its value as the chip shows it, normalized. */
function directiveParts(token: string): [string, string] {
  const hash = parseHashSearchToken(token);
  if (hash !== null) return [HASH_SEARCH_PREFIX, hash];
  const ext = parseExtSearchToken(token);
  if (ext !== null) return [EXT_SEARCH_PREFIX, ext];
  const rating = parseRatingSearchToken(token);
  if (rating !== null) return [RATING_SEARCH_PREFIX, ratingSearchText(rating)];
  if (isFavoriteSearchToken(token))
    return [IS_SEARCH_PREFIX, FAVORITE_SEARCH_VALUE];
  return [TAG_SEARCH_PREFIX, parseTagSearchToken(token) ?? ""];
}
