// Editor for one dictionary entry: the terms it finds, the tags it then adds,
// how it matches, and the files it finds.
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { searchLibrary } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import {
  KEYWORD_MODES,
  MAX_AUTO_TAG_KEYWORD_TAGS,
  MAX_AUTO_TAG_KEYWORD_TERMS,
  type KeywordEntry,
  type KeywordMode,
} from "@shared/autoTag";
import { segments } from "@shared/autoTagAnalysis";
import { anyOfSearchToken } from "@shared/tags";
import {
  MAX_ROWS,
  MONO,
  addKeywordTags,
  cleanTerms,
  keywordMatches,
} from "./helpers";
import {
  ChipListField,
  Highlighted,
  MoreRows,
  Segmented,
  SmallButton,
} from "./parts";

const MODE_LABELS: Record<KeywordMode, TranslationKey> = {
  word: "autoTag.mode.word",
  contains: "autoTag.mode.contains",
};

const MODE_HINTS: Record<KeywordMode, TranslationKey> = {
  word: "autoTag.mode.wordHint",
  contains: "autoTag.mode.containsHint",
};

export function KeywordEditor({
  entry,
  names,
  existing,
  onChange,
  onDelete,
}: {
  entry: KeywordEntry;
  names: readonly string[];
  /** The user's tags: lowercase → the spelling in use. */
  existing: ReadonlyMap<string, string>;
  onChange: (change: Partial<KeywordEntry>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const rows = keywordMatches(entry, names);

  // The library's own search, with the entry's terms as alternatives of one
  // token, in place of whatever was being searched for. It is the search box's
  // idea of a match, not the dictionary's: a substring of the whole path and
  // of the tags, with no word boundaries.
  const searchInLibrary = () => {
    searchLibrary([anyOfSearchToken(entry.terms)]);
    void navigate("/");
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4">
      <ChipListField
        kind="term"
        label={t("autoTag.keyword.terms")}
        items={entry.terms}
        max={MAX_AUTO_TAG_KEYWORD_TERMS}
        addLabel={t("autoTag.keyword.addTerm")}
        removeLabel={(term) => t("autoTag.keyword.removeTerm", { term })}
        empty={t("autoTag.keyword.noTerms")}
        heading={
          <SmallButton
            variant="ghost"
            className="ml-auto h-[26px] hover:text-error"
            onClick={onDelete}
          >
            {t("autoTag.deleteKeyword")}
          </SmallButton>
        }
        onAdd={(raw) => {
          const terms = cleanTerms([...entry.terms, ...raw]);
          if (terms.length !== entry.terms.length) onChange({ terms });
        }}
        onRemove={(term) =>
          onChange({ terms: entry.terms.filter((x) => x !== term) })
        }
      />

      <ChipListField
        kind="tag"
        label={t("autoTag.keyword.tags")}
        items={entry.tags}
        max={MAX_AUTO_TAG_KEYWORD_TAGS}
        addLabel={t("autoTag.keyword.addTag")}
        removeLabel={(tag) => t("autoTag.keyword.removeTag", { tag })}
        empty={t("autoTag.keyword.noTags")}
        onAdd={(raw) => {
          const tags = addKeywordTags(entry.tags, raw, existing);
          if (tags.length !== entry.tags.length) onChange({ tags });
        }}
        onRemove={(tag) =>
          onChange({ tags: entry.tags.filter((x) => x !== tag) })
        }
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">{t("autoTag.matchMode")}</span>
        <Segmented
          label={t("autoTag.matchMode")}
          value={entry.mode}
          onChange={(mode) => onChange({ mode })}
          options={KEYWORD_MODES.map((value) => ({
            value,
            label: t(MODE_LABELS[value]),
          }))}
        />
        <span className="text-xs text-muted">{t(MODE_HINTS[entry.mode])}</span>
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-fg">
          <span className="font-semibold">{t("autoTag.matchingFiles")}</span>
          <span className="text-muted">
            {t("autoTag.fileCount", { count: rows.length })}
          </span>
          <SmallButton
            className="ml-auto h-[26px] gap-1 border-border px-2"
            title={t("autoTag.searchInLibraryHint")}
            onClick={searchInLibrary}
          >
            <Search className="mr-1 inline size-3.5" />
            {t("autoTag.searchInLibrary")}
          </SmallButton>
        </div>
        {rows.slice(0, MAX_ROWS).map((row, i) => (
          <div
            key={i}
            className={cn(
              MONO,
              "break-all border-b border-surface px-3 py-1.5 text-[13px] text-fg",
            )}
          >
            <Highlighted segs={segments(row.name, row.hits)} />
          </div>
        ))}
        {rows.length === 0 && (
          <p className="p-3 text-xs text-muted">
            {t("autoTag.noMatchingFiles")}
          </p>
        )}
        <MoreRows t={t} hidden={rows.length - MAX_ROWS} />
      </div>
    </section>
  );
}
