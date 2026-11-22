import {
  EXT_SEARCH_PREFIX,
  HASH_SEARCH_PREFIX,
  TAG_SEARCH_PREFIX,
  parseExtSearchToken,
  parseHashSearchToken,
  parseNumericSearchToken,
  parseTagSearchToken,
} from "@shared/tags";
import type { TFunc } from "@/i18n/I18nProvider";
import { generatedTagChipLabel } from "@/lib/tagLabel";

/** What a search chip reads: `tag:beach`, or a generated tag's `Tempo: Fast`. */
export function SearchChipLabel({ t, token }: { t: TFunc; token: string }) {
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
      {human ?? (
        <>
          <span className="text-muted">{prefix}:</span>
          {body}
        </>
      )}
    </span>
  );
}
