// Editor for one dictionary entry: its aliases, how it matches, and the files
// it finds.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { applyTagFilter } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import {
  KEYWORD_MODES,
  type KeywordEntry,
  type KeywordMode,
} from "@shared/autoTag";
import { segments } from "@shared/autoTagAnalysis";
import { MAX_TAG_NAME, anyOfSearchToken } from "@shared/tags";
import { MAX_ROWS, MONO, cleanAliases, keywordMatches } from "./helpers";
import { Chip, Highlighted, MoreRows, Segmented, SmallButton } from "./parts";

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
  const [aliasDraft, setAliasDraft] = useState("");

  const addAlias = () => {
    const aliases = cleanAliases([...entry.aliases, aliasDraft], entry.tag);
    if (aliases.length !== entry.aliases.length) onChange({ aliases });
    setAliasDraft("");
  };

  const rows = keywordMatches(entry, names);

  // The library's own search, with the entry's terms as alternatives of one
  // token. It is the search box's idea of a match, not the dictionary's: a
  // substring of the whole path and of the tags, with no word boundaries.
  const searchInLibrary = () => {
    applyTagFilter([anyOfSearchToken([entry.tag, ...entry.aliases])]);
    void navigate("/");
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Chip className="px-2 text-sm leading-5">{entry.tag}</Chip>
        <span className="text-xs text-muted">
          {existing.has(entry.tag.toLowerCase())
            ? t("autoTag.joinsExisting", {
                tag: existing.get(entry.tag.toLowerCase()) ?? "",
              })
            : t("autoTag.createsNew")}
        </span>
        <SmallButton
          variant="ghost"
          className="ml-auto h-[26px] hover:text-error"
          onClick={onDelete}
        >
          {t("autoTag.deleteKeyword")}
        </SmallButton>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">{t("autoTag.aliases")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.aliases.map((alias) => (
            <span
              key={alias}
              className={cn(
                MONO,
                "flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border pl-2 pr-1 text-xs text-fg",
              )}
            >
              {alias}
              <button
                type="button"
                aria-label={t("autoTag.removeAlias", { alias })}
                onClick={() =>
                  onChange({
                    aliases: entry.aliases.filter((a) => a !== alias),
                  })
                }
                className="px-1 text-[13px] text-muted hover:text-bright-fg"
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="h-6 w-36 rounded-md border border-dashed border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
            value={aliasDraft}
            maxLength={MAX_TAG_NAME}
            placeholder={t("autoTag.addAlias")}
            aria-label={t("autoTag.addAlias")}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAlias()}
          />
        </div>
      </div>

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
