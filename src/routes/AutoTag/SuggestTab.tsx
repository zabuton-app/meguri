// Suggestions tab: frequent words of the file names that no rule or keyword
// produces yet — to apply, register as keywords, or dismiss.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { searchLibrary } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import { MAX_AUTO_TAG_KEYWORDS, type KeywordEntry } from "@shared/autoTag";
import { anyOfSearchToken } from "@shared/tags";
import { segments, type Candidate } from "@shared/autoTagAnalysis";
import { isAutoMetaValue } from "./autoMeta";
import { MONO, newKeyword, type CandidateState } from "./helpers";
import { usePaging } from "./paging";
import {
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
import type { AutoTagState } from "./useAutoTag";
import { useViewState } from "./viewState";

// The dismissed ones are a list of their own: out of the way everywhere else,
// and here to be brought back.
type Filter = "all" | "ignored";
const FILTERS = ["all", "ignored"] as const;

const FILTER_LABELS: Record<Filter, TranslationKey> = {
  all: "autoTag.filter.all",
  ignored: "autoTag.status.ignored",
};

type AppliedFilter = "any" | "unapplied" | "applied";

const APPLIED_FILTERS = ["any", "unapplied", "applied"] as const;

const APPLIED_LABELS: Record<AppliedFilter, TranslationKey> = {
  any: "autoTag.filter.appliedAny",
  unapplied: "autoTag.filter.unappliedOnly",
  applied: "autoTag.filter.appliedOnly",
};

/** For a candidate the screen has no state for; none is expected. */
const NOT_PENDING: CandidateState = {
  ignored: false,
  canRegister: false,
  missing: 0,
  tagged: 0,
  pending: false,
};

/** A row of the candidate list: its cells sit on the list's own columns. */
const ROW = "col-span-full grid grid-cols-subgrid items-center";

/** Files shown when a candidate is expanded. */
const MAX_EXPANDED_FILES = 50;

export function SuggestTab({
  state,
  candidates,
  states,
  pending: pendingTotal,
}: {
  state: AutoTagState;
  candidates: Candidate[];
  /** Where each candidate stands, by key (see candidateState). */
  states: ReadonlyMap<string, CandidateState>;
  /** How many of them are still to be decided. */
  pending: number;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { config, update, fileTags, existing, names } = state;
  const [filter, setFilter] = useViewState<Filter>("suggest.filter", "all");
  // Whether the files carry the tag, as something to narrow by: the ones with
  // files left to tag, or the ones that are on files (to take off again).
  const [applied, setApplied] = useViewState<AppliedFilter>(
    "suggest.applied",
    "any",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useViewState<string | null>(
    "suggest.expanded",
    null,
  );
  const confirm = useConfirm();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Where each candidate stands is read from the configuration and the files,
  // never kept here (see candidateState). The map covers every candidate; the
  // fallback only keeps the types honest.
  const stateOf = (c: Candidate): CandidateState =>
    states.get(c.key) ?? NOT_PENDING;

  // Dismissing a candidate takes it out of the lists: what is left in them is
  // what has not been decided yet.
  const counts: Record<Filter, number> = { all: 0, ignored: 0 };
  for (const c of candidates) counts[stateOf(c).ignored ? "ignored" : "all"]++;
  // Applying once leaves a word listed (the keywords still do not hold it),
  // so the ones with files left to tag can be asked for on their own.
  const shown = candidates.filter((c) => {
    if (stateOf(c).ignored !== (filter === "ignored")) return false;
    if (applied === "unapplied") return stateOf(c).missing > 0;
    if (applied === "applied") return stateOf(c).tagged > 0;
    return true;
  });
  const paging = usePaging(
    "suggest.page",
    `${filter}\0${applied}`,
    shown.length,
  );
  // What a row's checkbox is for: the candidates something can be done with —
  // still to be decided, or on files and so to be taken off them — or, among
  // the dismissed ones, any of them, to be brought back together.
  const onIgnored = filter === "ignored";
  const selectable = (c: Candidate): boolean => {
    const at = stateOf(c);
    return onIgnored ? at.ignored : at.pending || at.tagged > 0;
  };
  const pendingShown = shown.filter(selectable);
  const picked = pendingShown.filter((c) => selected.has(c.key));
  const allChecked =
    pendingShown.length > 0 && picked.length === pendingShown.length;
  /** Files a removal of these would reach: the ones carrying the tag. */
  const taggedFilesOf = (list: Candidate[]): number => {
    const set = new Set<number>();
    for (const c of list) {
      for (const index of c.files.keys()) {
        if (fileTags[index].has(c.key)) set.add(index);
      }
    }
    return set.size;
  };
  /** Files an apply of these would tag: the ones still lacking the tag. */
  const filesOf = (list: Candidate[]): number => {
    const set = new Set<number>();
    for (const c of list) {
      for (const index of c.files.keys()) {
        if (!fileTags[index].has(c.key)) set.add(index);
      }
    }
    return set.size;
  };

  const canRegister = (c: Candidate): boolean => stateOf(c).canRegister;

  // The library's own search for the spellings this candidate was found
  // under, in place of whatever was being searched for. By the search box's
  // rules — a substring of the path or of the tags — so it can list more than
  // the files counted here.
  const searchInLibrary = (c: Candidate) => {
    searchLibrary([anyOfSearchToken([c.name, ...c.variants])]);
    void navigate("/");
  };

  const apply = async (list: Candidate[], dict: boolean) => {
    if (list.length === 0 || busy) return;
    setBusy(true);
    // What really happened, which is what the notice reports: a candidate
    // whose files all had the tag was not tagged, and an entry the keywords
    // had no room for was not added.
    const tagged: Candidate[] = [];
    const entries: KeywordEntry[] = [];
    let keywords = config.keywords;
    let files = 0;
    let left = 0;
    for (const cand of list) {
      const perFile = new Map<number, string[]>();
      for (const index of cand.files.keys()) perFile.set(index, [cand.name]);
      const outcome = await state.apply(perFile);
      // A failure was reported already; the rest of the batch would only fail
      // the same way, and nothing that did not happen is marked as done.
      if (!outcome.ok) break;
      if (outcome.files > 0) {
        files += outcome.files;
        tagged.push(cand);
      }
      if (dict && canRegister(cand)) {
        // newKeyword is the one judge of whether an entry can be added.
        const entry = newKeyword(keywords, [cand.name], existing);
        if (entry) {
          keywords = [...keywords, entry];
          entries.push(entry);
        } else if (keywords.length >= MAX_AUTO_TAG_KEYWORDS) {
          // The keywords filled up partway through the batch.
          left++;
        }
      }
    }
    if (entries.length > 0) {
      update((c) => {
        let merged = c.keywords;
        for (const entry of entries) {
          // Still by newKeyword's rules, against what is there by now.
          if (newKeyword(merged, entry.terms, existing)) {
            merged = [...merged, entry];
          }
        }
        return { ...c, keywords: merged };
      });
    }
    setSelected(new Set());
    const appliedText =
      tagged.length === 0
        ? ""
        : tagged.length === 1
          ? t("autoTag.appliedOne", { tag: tagged[0].name, files })
          : t("autoTag.appliedMany", { tags: tagged.length, files });
    setNotice(
      (entries.length === 0
        ? appliedText
        : appliedText
          ? appliedText + t("autoTag.appliedDictSuffix")
          : t("autoTag.addedKeywords", { count: entries.length })) +
        (left > 0 ? t("autoTag.keywordsFullSuffix", { count: left }) : ""),
    );
    setBusy(false);
  };

  const ignore = (list: Candidate[]) => {
    const keys = list.map((c) => c.key);
    update((c) => ({ ...c, ignored: [...new Set([...c.ignored, ...keys])] }));
    setSelected(new Set());
  };

  /**
   * Take the tag off every file the candidate names that carries it. There is
   * no telling which of them the screen tagged and which were tagged by hand,
   * so it asks first, and says how many.
   */
  const remove = async (c: Candidate) => {
    const count = stateOf(c).tagged;
    if (count === 0 || busy) return;
    const ok = await confirm({
      title: t("autoTag.removeTitle", { tag: c.name }),
      message: t("autoTag.removeMessage", { tag: c.name, count }),
      confirmText: t("autoTag.removeConfirm"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const outcome = await state.remove([...c.files.keys()], c.key);
    setBusy(false);
    setNotice(
      outcome.ok
        ? t("autoTag.removedOne", { tag: c.name, files: outcome.files })
        : "",
    );
  };

  /** The same for several at once, asked about once. */
  const removeMany = async (list: Candidate[]) => {
    const targets = list.filter((c) => stateOf(c).tagged > 0);
    if (targets.length === 0 || busy) return;
    const ok = await confirm({
      title: t("autoTag.removeManyTitle", { tags: targets.length }),
      message: t("autoTag.removeManyMessage", {
        tags: targets.length,
        files: taggedFilesOf(targets),
      }),
      confirmText: t("autoTag.removeConfirm"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    let tags = 0;
    let files = 0;
    for (const c of targets) {
      const outcome = await state.remove([...c.files.keys()], c.key);
      // A failure was reported already, and the list read again.
      if (!outcome.ok) break;
      tags++;
      files += outcome.files;
    }
    setBusy(false);
    setSelected(new Set());
    setNotice(tags > 0 ? t("autoTag.removedMany", { tags, files }) : "");
  };

  const restore = (list: Candidate[]) => {
    const keys = new Set(list.map((c) => c.key));
    update((cfg) => ({
      ...cfg,
      ignored: cfg.ignored.filter((key) => !keys.has(key)),
    }));
    setSelected(new Set());
    setNotice("");
  };

  return (
    <>
      <Toolbar>
        <span className="min-w-[220px] flex-[1_1_260px] text-xs text-fg">
          {state.loading
            ? t("autoTag.analyzing")
            : t("autoTag.analyzed", {
                files: names.length,
                candidates: counts.all,
                pending: pendingTotal,
              })}
        </span>
        <Segmented
          tone="bg"
          label={t("autoTag.filter.label")}
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((value) => ({
            value,
            label: t(FILTER_LABELS[value]),
            count: counts[value],
          }))}
        />
        {/* One of the three, as a switch: a candidate can be on some of its
            files and not on others, so "applied" and "not applied" are not
            two boxes to tick together. */}
        <Segmented
          tone="bg"
          label={t("autoTag.filter.appliedLabel")}
          value={applied}
          onChange={setApplied}
          options={APPLIED_FILTERS.map((value) => ({
            value,
            label: t(APPLIED_LABELS[value]),
          }))}
        />
        <SmallButton
          // Not while tags are being written: what comes back is applied to
          // the list by position, and a reload would put another list there.
          disabled={state.loading || busy}
          onClick={() => {
            setNotice("");
            setSelected(new Set());
            state.reload();
          }}
        >
          {t("autoTag.reanalyze")}
        </SmallButton>
      </Toolbar>
      {notice && <Notice>{notice}</Notice>}

      <TabScroll>
        {/* One grid for the heading and every row (each a subgrid of it), so
            a column is as wide in one row as in the next: each action has a
            column of its own, left empty where a row does not offer it. */}
        <div className="grid grid-cols-[28px_minmax(160px,1fr)_auto_auto_auto_auto_auto_auto_auto] gap-x-2">
          <div
            className={cn(
              ROW,
              "sticky top-0 z-[1] border-b border-border bg-bg px-3 py-1.5 text-[11px] text-muted",
            )}
          >
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              aria-label={t("autoTag.selectAll")}
              checked={allChecked}
              onChange={() =>
                setSelected(
                  allChecked
                    ? new Set()
                    : new Set(pendingShown.map((c) => c.key)),
                )
              }
            />
            <span>{t("autoTag.col.candidate")}</span>
            <span className="text-right">{t("autoTag.col.files")}</span>
            <span className="col-span-6" />
          </div>
          {shown.slice(paging.start, paging.end).map((c) => {
            const at = stateOf(c);
            const open = expanded === c.key;
            return (
              <div
                key={c.key}
                className="col-span-full grid grid-cols-subgrid border-b border-surface"
              >
                <div className={cn(ROW, "px-3 py-2 hover:bg-fg/5")}>
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    aria-label={c.name}
                    disabled={!selectable(c)}
                    checked={selectable(c) && selected.has(c.key)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (!next.delete(c.key)) next.add(c.key);
                      setSelected(next);
                    }}
                  />
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : c.key)}
                    className="flex min-w-0 flex-col items-start gap-[3px] text-left"
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-block w-3.5 text-center text-xs text-fg">
                        {open ? "▾" : "▸"}
                      </span>
                      <Chip className="text-[13px]">{c.name}</Chip>
                      <span
                        className={cn(
                          "text-[11px]",
                          existing.has(c.key) ? "text-primary" : "text-muted",
                        )}
                      >
                        {existing.has(c.key)
                          ? t("autoTag.toExisting", {
                              tag: existing.get(c.key) ?? "",
                            })
                          : t("autoTag.newTag")}
                      </span>
                    </span>
                    {c.variants.length > 1 && (
                      <span className="pl-5 text-[11px] text-muted">
                        {t("autoTag.variants", {
                          list: c.variants.join(" · "),
                        })}
                      </span>
                    )}
                    {isAutoMetaValue(c.key) && (
                      <span className="pl-5 text-[11px] text-warn">
                        {t("autoTag.autoMetaWarning")}
                      </span>
                    )}
                  </button>
                  <span className="text-right text-xs tabular-nums text-fg">
                    {c.count}
                  </span>
                  {/* Whatever was done with it: looking at the files is how
                    one decides, and how one checks afterwards. */}
                  {/* By the spellings found in the names: a search for the
                      tag itself would list other files than the ones counted
                      here. */}
                  <SmallButton
                    variant="ghost"
                    className="h-[26px] px-2"
                    onClick={() => searchInLibrary(c)}
                    title={t("autoTag.searchCandidateHint")}
                  >
                    {t("autoTag.viewFiles")}
                  </SmallButton>
                  <span className="whitespace-nowrap text-xs text-muted">
                    {at.ignored && t("autoTag.status.ignored")}
                  </span>
                  {at.ignored ? (
                    <button
                      type="button"
                      onClick={() => restore([c])}
                      className="h-[26px] justify-self-start px-2 text-xs text-muted underline underline-offset-2 hover:text-bright-fg"
                    >
                      {t("autoTag.revert")}
                    </button>
                  ) : at.tagged > 0 ? (
                    <SmallButton
                      variant="ghost"
                      className="h-[26px] px-2"
                      disabled={busy}
                      title={t("autoTag.removeHint")}
                      onClick={() => void remove(c)}
                    >
                      {t("autoTag.removeFromFiles", { count: at.tagged })}
                    </SmallButton>
                  ) : (
                    <span />
                  )}
                  {/* Registering is the main action: the tag then keeps being
                    applied by the Keywords tab's entries instead of this once
                    — offered whether or not the files are tagged already. */}
                  {!at.ignored && at.canRegister ? (
                    <SmallButton
                      variant="primary"
                      className="h-[26px]"
                      disabled={busy}
                      // The short label fits the row; what it does in full.
                      title={t("autoTag.applySelectedDict")}
                      onClick={() => void apply([c], true)}
                    >
                      {t("autoTag.addToDictionary")}
                    </SmallButton>
                  ) : (
                    <span />
                  )}
                  {/* The one-off apply; the main action only once the keywords
                    are full and registering is off the table. */}
                  {!at.ignored && at.missing > 0 ? (
                    <SmallButton
                      variant={at.canRegister ? "outline" : "primary"}
                      className={cn(
                        "h-[26px]",
                        at.canRegister && "border-border px-2",
                      )}
                      disabled={busy}
                      onClick={() => void apply([c], false)}
                    >
                      {t("autoTag.apply")}
                    </SmallButton>
                  ) : (
                    <span />
                  )}
                  {at.pending ? (
                    <SmallButton
                      variant="ghost"
                      className="h-[26px] px-2"
                      onClick={() => ignore([c])}
                    >
                      {t("autoTag.ignore")}
                    </SmallButton>
                  ) : (
                    <span />
                  )}
                </div>
                {open && (
                  <div className="col-span-full flex flex-col gap-0.5 pb-2.5 pl-14 pr-3">
                    {[...c.files.entries()]
                      .slice(0, MAX_EXPANDED_FILES)
                      .map(([index, ranges]) => (
                        <div
                          key={index}
                          className={cn(
                            MONO,
                            "break-all py-0.5 text-xs text-fg",
                          )}
                        >
                          <Highlighted segs={segments(names[index], ranges)} />
                        </div>
                      ))}
                    <MoreRows
                      t={t}
                      hidden={c.files.size - MAX_EXPANDED_FILES}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p className="p-8 text-center text-[13px] text-muted">
            {state.loading ? t("autoTag.analyzing") : t("autoTag.noCandidates")}
          </p>
        )}
      </TabScroll>
      <Pager t={t} paging={paging} />

      {picked.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2">
          {onIgnored ? (
            <>
              <span className="text-xs text-fg">
                {t("autoTag.selectionIgnored", { count: picked.length })}
              </span>
              <SmallButton variant="primary" onClick={() => restore(picked)}>
                {t("autoTag.revert")}
              </SmallButton>
            </>
          ) : (
            <>
              <span className="text-xs text-fg">
                {picked.some((c) => stateOf(c).missing > 0)
                  ? t("autoTag.selection", {
                      count: picked.length,
                      files: filesOf(picked),
                    })
                  : t("autoTag.selectionIgnored", { count: picked.length })}
              </span>
              {picked.some(canRegister) && (
                <SmallButton
                  variant="primary"
                  disabled={busy}
                  onClick={() => void apply(picked, true)}
                >
                  {t("autoTag.applySelectedDict")}
                </SmallButton>
              )}
              {picked.some((c) => stateOf(c).missing > 0) && (
                <SmallButton
                  variant={picked.some(canRegister) ? "outline" : "primary"}
                  disabled={busy}
                  onClick={() => void apply(picked, false)}
                >
                  {t("autoTag.applySelected")}
                </SmallButton>
              )}
              {picked.some((c) => stateOf(c).tagged > 0) && (
                <SmallButton
                  disabled={busy}
                  onClick={() => void removeMany(picked)}
                >
                  {t("autoTag.removeSelected", {
                    files: taggedFilesOf(picked),
                  })}
                </SmallButton>
              )}
              {picked.some((c) => stateOf(c).pending) && (
                <SmallButton
                  variant="ghost"
                  onClick={() =>
                    ignore(picked.filter((c) => stateOf(c).pending))
                  }
                >
                  {t("autoTag.ignore")}
                </SmallButton>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-muted hover:text-fg hover:underline"
          >
            {t("autoTag.clearSelection")}
          </button>
        </div>
      )}
    </>
  );
}
