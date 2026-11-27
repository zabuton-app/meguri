import {
  SEARCH_NOT,
  TAG_SEARCH_PREFIX,
  parseNegatedSearchToken,
  parseSearchDirective,
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
  const d = parseSearchDirective(token);
  const prefix = d?.prefix ?? TAG_SEARCH_PREFIX;
  const body = d?.value ?? "";
  // A generated tag reads as its category and value (`Tempo: Fast`).
  const human = d?.kind === "tag" ? generatedTagChipLabel(t, token) : null;
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
