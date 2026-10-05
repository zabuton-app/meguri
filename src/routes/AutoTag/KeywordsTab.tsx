// Keyword dictionary tab: tags with their aliases, and the files each one finds.
import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  KEYWORD_MODES,
  compileKeyword,
  runKeyword,
  type KeywordEntry,
  type KeywordHit,
  type KeywordMode,
} from "@shared/autoTag";
import { segments } from "@shared/autoTagAnalysis";
import { FIELD, MAX_ROWS, MONO, cleanAliases, newKeyword } from "./helpers";
import { MAX_TAG_NAME } from "@shared/tags";
import {
  Chip,
  Highlighted,
  MoreRows,
  Segmented,
  SmallButton,
  TabScroll,
  Toolbar,
} from "./parts";
import type { AutoTagState } from "./useAutoTag";

const MODE_LABELS: Record<KeywordMode, TranslationKey> = {
  word: "autoTag.mode.word",
  contains: "autoTag.mode.contains",
};

const MODE_HINTS: Record<KeywordMode, TranslationKey> = {
  word: "autoTag.mode.wordHint",
  contains: "autoTag.mode.containsHint",
};

type KeywordMatches = { name: string; hits: KeywordHit[] }[];

// Per entry object and per names array: editing one entry leaves the matches
// of the others alone. Outside React on purpose — it is a pure memo.
const matchCache = new WeakMap<
  KeywordEntry,
  { names: readonly string[]; rows: KeywordMatches }
>();

function matchesOf(
  entry: KeywordEntry,
  names: readonly string[],
): KeywordMatches {
  const cached = matchCache.get(entry);
  if (cached?.names === names) return cached.rows;
  const rows: KeywordMatches = [];
  const compiled = compileKeyword(entry);
  if (compiled) {
    for (const name of names) {
      const hits = runKeyword(compiled, name);
      if (hits.length > 0) rows.push({ name, hits });
    }
  }
  matchCache.set(entry, { names, rows });
  return rows;
}

export function KeywordsTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const { config, update, names, existing } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTag, setDraftTag] = useState("");
  const [draftAliases, setDraftAliases] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");

  const selected =
    config.keywords.find((k) => k.id === selectedId) ?? config.keywords[0];

  const matches = (entry: KeywordEntry) => matchesOf(entry, names);

  const patch = (id: string, change: Partial<KeywordEntry>) =>
    update((c) => ({
      ...c,
      keywords: c.keywords.map((k) => (k.id === id ? { ...k, ...change } : k)),
    }));

  const submit = () => {
    const entry = newKeyword(
      config.keywords,
      draftTag,
      draftAliases.split(/[,、]/),
    );
    if (!entry) return;
    update((c) => ({ ...c, keywords: [...c.keywords, entry] }));
    setSelectedId(entry.id);
    setDraftTag("");
    setDraftAliases("");
  };

  const addAlias = () => {
    if (!selected) return;
    const aliases = cleanAliases(
      [...selected.aliases, aliasDraft],
      selected.tag,
    );
    if (aliases.length !== selected.aliases.length) {
      patch(selected.id, { aliases });
    }
    setAliasDraft("");
  };

  const rows = selected ? matches(selected) : [];

  return (
    <>
      <Toolbar>
        <input
          className={cn(FIELD, "h-7 w-44 bg-bg text-xs")}
          value={draftTag}
          maxLength={MAX_TAG_NAME}
          placeholder={t("autoTag.keywordTagPlaceholder")}
          aria-label={t("autoTag.keywordTagPlaceholder")}
          onChange={(e) => setDraftTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <input
          className={cn(
            FIELD,
            "h-7 max-w-[360px] flex-[1_1_220px] bg-bg text-xs",
          )}
          value={draftAliases}
          placeholder={t("autoTag.keywordAliasesPlaceholder")}
          aria-label={t("autoTag.keywordAliasesPlaceholder")}
          onChange={(e) => setDraftAliases(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <SmallButton variant="primary" onClick={submit}>
          {t("autoTag.addKeyword")}
        </SmallButton>
        <span className="ml-auto text-xs text-muted">
          {t("autoTag.keywordHint")}
        </span>
      </Toolbar>

      <TabScroll className="@container flex flex-wrap">
        <>
          <aside className="flex flex-[1_1_300px] flex-col gap-0.5 border-b border-border p-3 @[760px]:max-w-[380px] @[760px]:border-b-0 @[760px]:border-r">
            {config.keywords.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setSelectedId(entry.id);
                  setAliasDraft("");
                }}
                aria-current={entry.id === selected?.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg p-2 text-left",
                  entry.id === selected?.id ? "bg-overlay" : "hover:bg-surface",
                )}
              >
                <Chip className="shrink-0">{entry.tag}</Chip>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {entry.aliases.join(", ") || t("autoTag.noAliases")}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {t("autoTag.fileCount", { count: matches(entry).length })}
                </span>
              </button>
            ))}
            {config.keywords.length === 0 && (
              <p className="p-2 text-xs text-muted">
                {t("autoTag.noKeywords")}
              </p>
            )}
          </aside>

          {selected && (
            <section className="flex min-w-0 flex-[3_1_460px] flex-col gap-4 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <Chip className="px-2 text-sm leading-5">{selected.tag}</Chip>
                <span className="text-xs text-muted">
                  {existing.has(selected.tag.toLowerCase())
                    ? t("autoTag.joinsExisting", {
                        tag: existing.get(selected.tag.toLowerCase()) ?? "",
                      })
                    : t("autoTag.createsNew")}
                </span>
                <SmallButton
                  variant="ghost"
                  className="ml-auto h-[26px] hover:text-error"
                  onClick={() => {
                    update((c) => ({
                      ...c,
                      keywords: c.keywords.filter((k) => k.id !== selected.id),
                    }));
                    setSelectedId(null);
                  }}
                >
                  {t("autoTag.deleteKeyword")}
                </SmallButton>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted">
                  {t("autoTag.aliases")}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selected.aliases.map((alias) => (
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
                          patch(selected.id, {
                            aliases: selected.aliases.filter(
                              (a) => a !== alias,
                            ),
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
                <span className="text-xs text-muted">
                  {t("autoTag.matchMode")}
                </span>
                <Segmented
                  label={t("autoTag.matchMode")}
                  value={selected.mode}
                  onChange={(mode) => patch(selected.id, { mode })}
                  options={KEYWORD_MODES.map((value) => ({
                    value,
                    label: t(MODE_LABELS[value]),
                  }))}
                />
                <span className="text-xs text-muted">
                  {t(MODE_HINTS[selected.mode])}
                </span>
              </div>

              <div className="flex flex-col overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-surface px-3 py-2 text-xs text-fg">
                  <span className="font-semibold">
                    {t("autoTag.matchingFiles")}
                  </span>{" "}
                  <span className="text-muted">
                    {t("autoTag.fileCount", { count: rows.length })}
                  </span>
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
          )}
        </>
      </TabScroll>
    </>
  );
}
