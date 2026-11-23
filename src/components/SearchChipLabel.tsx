import {
  EXT_SEARCH_PREFIX,
  HASH_SEARCH_PREFIX,
  SEARCH_NOT,
  TAG_SEARCH_PREFIX,
  parseExtSearchToken,
  parseHashSearchToken,
  parseNumericSearchToken,
  parseNegatedSearchToken,
  parseTagSearchToken,
} from "@shared/tags";
import type { TFunc } from "@/i18n/I18nProvider";
import { generatedTagChipLabel } from "@/lib/tagLabel";

/** What a search chip reads: `tag:beach`, or a generated tag's `Tempo: Fast`;
 *  an exclusion (`-tag:beach`) struck through behind its `-`. */
export function SearchChipLabel({
  t,
  token: raw,
}: {
  t: TFunc;
  token: string;
}) {
  const { negated, body: token } = parseNegatedSearchToken(raw);
  const hash = parseHashSearchToken(token);
  const ext = parseExtSearchToken(token);
  const num = parseNumericSearchToken(token);
  const prefix =
    hash !== null
      ? HASH_SEARCH_PREFIX
      : ext !== null
        ? EXT_SEARCH_PREFIX
        : num !== null
          ? num.field
          : TAG_SEARCH_PREFIX;
  const body = hash ?? ext ?? num?.text ?? parseTagSearchToken(token) ?? "";
  const human =
    hash === null && ext === null && num === null
      ? generatedTagChipLabel(t, token)
      : null;
  return (
    <span className="truncate">
      {negated && <span className="text-error">{SEARCH_NOT}</span>}
      <span className={negated ? "line-through" : undefined}>
        {human ?? (
          <>
            <span className="text-muted">{prefix}:</span>
            {body}
          </>
        )}
      </span>
    </span>
  );
}
