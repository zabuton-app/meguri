// Terms tab: every word found across the file names, to be sorted into tags —
// make it a tag, fold it into another one (spelling variants), or exclude it.
import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import { cleanTagName, isUsableTagName } from "@shared/autoTag";
import {
  STOP_WORDS,
  TERM_TYPES,
  extractTerms,
  segments,
  type Candidate,
  type Term,
  type TermType,
} from "@shared/autoTagAnalysis";
import { MAX_TAG_NAME } from "@shared/tags";
import { isAutoMetaValue } from "./autoMeta";
import { FIELD, MAX_ROWS, MONO, cleanAliases, newKeyword } from "./helpers";
import {
  Badge,
  Chip,
  Highlighted,
  MoreRows,
  Pager,
  Notice,
  Segmented,
  SmallButton,
  TabScroll,
  Toolbar,
} from "./parts";
import type { AutoTagSession, TermDecision } from "./session";
import type { AutoTagState, UndoHandle } from "./useAutoTag";
import { usePaging } from "./paging";
import { useViewState } from "./viewState";

const TYPE_LABELS: Record<TermType, TranslationKey> = {
  code: "autoTag.terms.typeCode",
  bracket: "autoTag.terms.typeBracket",
  word: "autoTag.terms.typeWord",
  ja: "autoTag.terms.typeJa",
};

type TypeFilter = "all" | TermType;

/** Terms in fewer files than this are left out unless already decided. */
const MIN_COUNT = 2;
/** Files shown when a term is expanded. */
const MAX_EXPANDED_FILES = 8;

const BUILTIN_STOP = new Set(STOP_WORDS);
const GRID =
  "grid grid-cols-[minmax(0,1.3fr)_76px_52px_minmax(0,1.6fr)] items-center gap-x-3";

export function TermsTab({
  state,
  session,
  candidates,
}: {
  state: AutoTagState;
  session: AutoTagSession;
  candidates: Candidate[];
}) {
  const { t } = useI18n();
  const { config, update, names, existing } = state;

  // Excluded terms stay in the list (struck through), so only the built-in
  // stop words are dropped at extraction.
  const terms = useMemo(() => extractTerms(names, BUILTIN_STOP), [names]);

  const { overrides, setOverrides } = session;
  const [type, setType] = useViewState<TypeFilter>("terms.type", "all");
  const [onlyOpen, setOnlyOpen] = useViewState("terms.onlyOpen", false);
  const [query, setQuery] = useViewState("terms.query", "");
  const [open, setOpen] = useViewState<string | null>("terms.open", null);
  const [mergeDraft, setMergeDraft] = useState("");
  const [saveDict, setSaveDict] = useViewState("terms.saveDict", true);
  const [notice, setNotice] = useState<{
    text: string;
    undo?: UndoHandle;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const excluded = useMemo(
    () => new Set(config.excludedTerms),
    [config.excludedTerms],
  );
  // What the engine already decides: dictionary terms fold into their tag, and
  // anything a rule turns into a tag is a tag.
  const defaults = useMemo(() => {
    const map = new Map<string, TermDecision>();
    for (const c of candidates) {
      if (c.origins.some((o) => o !== "keyword" && o !== "frequent")) {
        map.set(c.key, { target: c.name, origin: "rule" });
      }
    }
    for (const entry of config.keywords) {
      for (const term of [entry.tag, ...entry.aliases]) {
        map.set(term.toLowerCase(), {
          target: entry.tag,
          origin: "dictionary",
        });
      }
    }
    return map;
  }, [candidates, config.keywords]);

  const decisionOf = (key: string): TermDecision | null => {
    if (excluded.has(key)) return null;
    const override = overrides.get(key);
    return override !== undefined ? override : (defaults.get(key) ?? null);
  };
  const decide = (key: string, decision: TermDecision | null) => {
    setNotice(null);
    setOverrides(new Map(overrides).set(key, decision));
    if (excluded.has(key)) {
      update((c) => ({
        ...c,
        excludedTerms: c.excludedTerms.filter((x) => x !== key),
      }));
    }
  };
  const exclude = (key: string) => {
    setNotice(null);
    update((c) => ({
      ...c,
      excludedTerms: [...new Set([...c.excludedTerms, key])],
    }));
  };

  const eligible = terms.filter(
    (term) =>
      term.count >= MIN_COUNT ||
      excluded.has(term.key) ||
      decisionOf(term.key) !== null,
  );
  const undecided = (term: Term) =>
    !excluded.has(term.key) && decisionOf(term.key) === null;
  const typeCounts: Record<TypeFilter, number> = {
    all: eligible.length,
    code: 0,
    bracket: 0,
    word: 0,
    ja: 0,
  };
  for (const term of eligible) typeCounts[term.type]++;
  const q = query.trim().toLowerCase();
  const shown = eligible.filter(
    (term) =>
      (type === "all" || term.type === type) &&
      (!onlyOpen || undecided(term)) &&
      (!q || term.key.includes(q)),
  );
  const paging = usePaging(
    "terms.page",
    `${type}\0${onlyOpen ? 1 : 0}\0${q}`,
    shown.length,
  );

  // --- the tags that would come out of the decisions ---------------------
  interface Group {
    name: string;
    terms: Term[];
    files: Set<number>;
    /** At least one member the user decided, not the engine. */
    chosen: boolean;
  }
  const groupMap = new Map<string, Group>();
  for (const term of terms) {
    const decision = decisionOf(term.key);
    if (!decision) continue;
    const key = decision.target.toLowerCase();
    let group = groupMap.get(key);
    if (!group) {
      group = {
        name: decision.target,
        terms: [],
        files: new Set(),
        chosen: false,
      };
      groupMap.set(key, group);
    }
    group.terms.push(term);
    if (!decision.origin) group.chosen = true;
    for (const index of term.files.keys()) group.files.add(index);
  }
  const groups = [...groupMap.values()].sort(
    (a, b) => b.files.size - a.files.size || a.name.localeCompare(b.name),
  );
  const largest = Math.max(1, ...groups.map((g) => g.files.size));
  const membersOf = (group: Group) =>
    group.terms.filter((term) => term.key !== group.name.toLowerCase());
  const aliasCount = groups.reduce((n, g) => n + membersOf(g).length, 0);
  const targetFiles = new Set<number>();
  for (const group of groups) for (const i of group.files) targetFiles.add(i);

  const apply = async () => {
    if (groups.length === 0 || busy) return;
    setBusy(true);
    const perFile = new Map<number, string[]>();
    for (const group of groups) {
      for (const index of group.files) {
        const tags = perFile.get(index);
        if (tags) tags.push(group.name);
        else perFile.set(index, [group.name]);
      }
    }
    // Only what the user decided here is worth remembering in the dictionary:
    // what the engine already yields would only be restated.
    const toRegister = saveDict ? groups.filter((g) => g.chosen) : [];
    const outcome = await state.apply(perFile);
    setBusy(false);
    if (!outcome.ok) return;
    // After the tags landed: a dictionary entry for tags that were never
    // applied would be a decision the user did not get to see through.
    if (toRegister.length > 0) {
      update((c) => {
        let keywords = c.keywords;
        for (const group of toRegister) {
          const aliases = membersOf(group).map((term) => term.display);
          const at = keywords.findIndex(
            (k) => k.tag.toLowerCase() === group.name.toLowerCase(),
          );
          if (at >= 0) {
            const entry = keywords[at];
            keywords = keywords.map((k, i) =>
              i === at
                ? {
                    ...entry,
                    aliases: cleanAliases(
                      [...entry.aliases, ...aliases],
                      entry.tag,
                    ),
                  }
                : k,
            );
          } else {
            const entry = newKeyword(keywords, group.name, aliases);
            if (entry) keywords = [...keywords, entry];
          }
        }
        return { ...c, keywords };
      });
    }
    setNotice({
      text:
        t("autoTag.terms.applied", {
          tags: groups.length,
          files: outcome.files,
        }) +
        (toRegister.length > 0
          ? t("autoTag.terms.registered", { count: toRegister.length })
          : ""),
      undo: outcome.undo ?? undefined,
    });
  };

  const mergeInto = (term: Term, rawName: string) => {
    const target = cleanTagName(rawName);
    if (!isUsableTagName(target)) return;
    decide(term.key, { target: existing.get(target.toLowerCase()) ?? target });
    setMergeDraft("");
  };

  return (
    <>
      <Toolbar>
        <input
          className={cn(FIELD, "h-7 w-44 bg-bg text-xs")}
          value={query}
          placeholder={t("autoTag.terms.search")}
          aria-label={t("autoTag.terms.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented
          tone="bg"
          label={t("autoTag.filter.label")}
          value={type}
          onChange={setType}
          options={(["all", ...TERM_TYPES] as const).map((value) => ({
            value,
            label:
              value === "all" ? t("autoTag.filter.all") : t(TYPE_LABELS[value]),
            count: typeCounts[value],
          }))}
        />
        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-fg">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          {t("autoTag.terms.onlyUndecided")}
        </label>
        <span className="ml-auto text-xs text-muted">
          {t("autoTag.terms.hint")}
        </span>
      </Toolbar>
      {notice && (
        <Notice
          undoLabel={t("autoTag.revert")}
          onUndo={
            notice.undo
              ? () => {
                  const handle = notice.undo;
                  setNotice(null);
                  if (handle) void state.undo(handle);
                }
              : undefined
          }
        >
          {notice.text}
        </Notice>
      )}

      <TabScroll className="@container flex flex-wrap">
        <section className="min-w-0 flex-[3_1_520px] border-border @[860px]:border-r">
          <div
            className={cn(
              GRID,
              "sticky top-0 z-[1] border-b border-border bg-bg px-3 py-1.5 text-[11px] text-muted",
            )}
          >
            <span>
              {t("autoTag.terms.colTerm", {
                count: eligible.length,
                undecided: eligible.filter(undecided).length,
              })}
            </span>
            <span>{t("autoTag.terms.colType")}</span>
            <span className="text-right">{t("autoTag.col.files")}</span>
            <span>{t("autoTag.terms.colDecision")}</span>
          </div>
          {shown.slice(paging.start, paging.end).map((term) => {
            const decision = decisionOf(term.key);
            const isExcluded = excluded.has(term.key);
            const isOpen = open === term.key;
            const self = decision?.target.toLowerCase() === term.key;
            const toggle = () => {
              setOpen(isOpen ? null : term.key);
              setMergeDraft("");
            };
            return (
              <div
                key={term.key}
                className={cn("border-b border-surface", isOpen && "bg-fg/5")}
              >
                <div className={cn(GRID, "px-3 py-[7px] hover:bg-fg/5")}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={toggle}
                    className="flex min-w-0 flex-col items-start gap-0.5 text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3.5 text-center text-xs text-fg">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span
                        className={cn(
                          MONO,
                          "text-[13px]",
                          isExcluded
                            ? "text-muted line-through"
                            : "text-bright-fg",
                        )}
                      >
                        {term.display}
                      </span>
                    </span>
                    {term.variants.length > 1 && (
                      <span className="pl-5 text-[11px] text-muted">
                        {t("autoTag.variants", {
                          list: term.variants.join(" · "),
                        })}
                      </span>
                    )}
                    {isAutoMetaValue(term.key) && (
                      <span className="pl-5 text-[11px] text-warn">
                        {t("autoTag.autoMetaWarning")}
                      </span>
                    )}
                  </button>
                  <Badge>{t(TYPE_LABELS[term.type])}</Badge>
                  <span className="text-right text-xs tabular-nums text-fg">
                    {term.count}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    {decision && (
                      <>
                        <span className="whitespace-nowrap text-xs text-muted">
                          {t(
                            self
                              ? "autoTag.terms.asTag"
                              : "autoTag.terms.mergedInto",
                          )}
                        </span>
                        <Chip className="whitespace-nowrap">
                          {decision.target}
                        </Chip>
                        {decision.origin && (
                          <span className="whitespace-nowrap text-[10px] text-primary">
                            {t(
                              decision.origin === "dictionary"
                                ? "autoTag.terms.fromDictionary"
                                : "autoTag.terms.fromRule",
                            )}
                          </span>
                        )}
                      </>
                    )}
                    {isExcluded && (
                      <span className="whitespace-nowrap text-xs text-muted">
                        {t("autoTag.excluded")}
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap justify-end gap-0.5">
                      {!decision && (
                        <SmallButton
                          variant="primary"
                          className="h-6 px-2"
                          onClick={() =>
                            decide(term.key, {
                              target:
                                existing.get(term.key) ??
                                cleanTagName(term.display),
                            })
                          }
                        >
                          {t("autoTag.terms.makeTag")}
                        </SmallButton>
                      )}
                      <SmallButton
                        className="h-6 border-border px-2"
                        onClick={toggle}
                      >
                        {t("autoTag.terms.merge")}
                      </SmallButton>
                      {!isExcluded && (
                        <SmallButton
                          variant="ghost"
                          className="h-6 px-2"
                          onClick={() => exclude(term.key)}
                        >
                          {t("autoTag.terms.exclude")}
                        </SmallButton>
                      )}
                      {(decision || isExcluded) && (
                        <SmallButton
                          variant="ghost"
                          className="h-6 px-1.5"
                          title={t("autoTag.terms.reset")}
                          aria-label={t("autoTag.terms.reset")}
                          onClick={() => decide(term.key, null)}
                        >
                          ↺
                        </SmallButton>
                      )}
                    </span>
                  </span>
                </div>
                {isOpen && (
                  <div className="flex flex-col gap-2.5 pb-3 pl-8 pr-3 pt-0.5">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] text-muted">
                        {t("autoTag.terms.mergeHeading")}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {groups
                          .filter((g) => g.name.toLowerCase() !== term.key)
                          .slice(0, 40)
                          .map((g) => (
                            <button
                              key={g.name}
                              type="button"
                              onClick={() => mergeInto(term, g.name)}
                              className={cn(
                                "h-6 whitespace-nowrap rounded border bg-secondary-accent/15 px-2 text-xs text-bright-fg hover:bg-secondary-accent/30",
                                decision?.target === g.name
                                  ? "border-primary"
                                  : "border-transparent",
                              )}
                            >
                              {g.name}
                            </button>
                          ))}
                        <input
                          className="h-6 w-[150px] rounded-md border border-dashed border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
                          value={mergeDraft}
                          maxLength={MAX_TAG_NAME}
                          placeholder={t("autoTag.terms.otherTag")}
                          aria-label={t("autoTag.terms.otherTag")}
                          onChange={(e) => setMergeDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.nativeEvent.isComposing
                            ) {
                              mergeInto(term, mergeDraft);
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-muted">
                        {t("autoTag.terms.filesHeading")}
                      </span>
                      {[...term.files.entries()]
                        .slice(0, MAX_EXPANDED_FILES)
                        .map(([index, ranges]) => (
                          <div
                            key={index}
                            className={cn(
                              MONO,
                              "break-all py-px text-xs text-fg",
                            )}
                          >
                            <Highlighted
                              segs={segments(names[index], ranges)}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {shown.length === 0 && (
            <p className="p-8 text-center text-[13px] text-muted">
              {t("autoTag.terms.none")}
            </p>
          )}
        </section>

        <aside className="flex min-w-0 flex-[2_1_320px] flex-col">
          <div className="flex items-baseline gap-2 px-4 pb-2 pt-3">
            <span className="text-xs font-semibold text-fg">
              {t("autoTag.terms.resulting")}
            </span>
            <span className="text-xs tabular-nums text-muted">
              {t("autoTag.terms.resultingSummary", {
                tags: groups.length,
                aliases: aliasCount,
              })}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
            {groups.slice(0, MAX_ROWS).map((group) => {
              const members = membersOf(group);
              return (
                <div
                  key={group.name}
                  className="flex flex-col gap-1.5 rounded-lg p-2 hover:bg-surface"
                >
                  <div className="flex items-center gap-2">
                    <Chip className="whitespace-nowrap text-[13px]">
                      {group.name}
                    </Chip>
                    <span
                      className={cn(
                        "whitespace-nowrap text-[11px]",
                        existing.has(group.name.toLowerCase())
                          ? "text-primary"
                          : "text-muted",
                      )}
                    >
                      {existing.has(group.name.toLowerCase())
                        ? t("autoTag.existingTag")
                        : t("autoTag.newTag")}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-fg">
                      {t("autoTag.fileCount", { count: group.files.size })}
                    </span>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-sm bg-surface">
                    <div
                      className="h-full bg-secondary-accent opacity-70"
                      style={{
                        width: `${Math.round((group.files.size / largest) * 100)}%`,
                      }}
                    />
                  </div>
                  {members.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-muted">←</span>
                      {members.map((term) => (
                        <span
                          key={term.key}
                          className={cn(
                            MONO,
                            "flex h-5 items-center whitespace-nowrap rounded border border-border pl-1.5 pr-0.5 text-[11px] text-fg",
                          )}
                        >
                          {term.display}
                          <button
                            type="button"
                            aria-label={t("autoTag.terms.unmerge", {
                              term: term.display,
                            })}
                            onClick={() => decide(term.key, null)}
                            className="px-[3px] text-xs text-muted hover:text-bright-fg"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <MoreRows t={t} hidden={groups.length - MAX_ROWS} />
            {groups.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted">
                {t("autoTag.terms.noGroups")}
              </p>
            )}
          </div>
          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-surface px-4 py-2.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={saveDict}
                onChange={(e) => setSaveDict(e.target.checked)}
              />
              {t("autoTag.terms.saveDict")}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">
                {t("autoTag.terms.targets", {
                  files: targetFiles.size,
                  total: names.length,
                })}
              </span>
              <SmallButton
                variant="primary"
                className="ml-auto h-[30px] px-3.5 text-[13px]"
                disabled={busy || groups.length === 0}
                onClick={() => void apply()}
              >
                {t("autoTag.terms.apply", { count: groups.length })}
              </SmallButton>
            </div>
          </div>
        </aside>
      </TabScroll>
      <Pager t={t} paging={paging} />
    </>
  );
}
