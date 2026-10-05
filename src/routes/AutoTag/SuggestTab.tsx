// Suggestions tab: every tag the engine would give the files in scope, plus
// frequent words it does not pick up yet — to apply, register or dismiss.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { searchLibrary } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import { MAX_AUTO_TAG_KEYWORDS, type KeywordEntry } from "@shared/autoTag";
import { anyOfSearchToken } from "@shared/tags";
import {
  candidateGroup,
  segments,
  type Candidate,
  type CandidateOrigin,
} from "@shared/autoTagAnalysis";
import { isAutoMetaValue } from "./autoMeta";
import { MONO, newKeyword, type CandidateState } from "./helpers";
import { usePaging } from "./paging";
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
import type { AutoTagState } from "./useAutoTag";
import { useViewState } from "./viewState";

const ORIGIN_LABELS: Record<CandidateOrigin, TranslationKey> = {
  prefix: "autoTag.kind.prefix",
  bracket: "autoTag.kind.bracket",
  regex: "autoTag.kind.regex",
  keyword: "autoTag.origin.keyword",
  frequent: "autoTag.origin.frequent",
};

// Rules and the keywords are one group here, as they are one tab: both are
// what the Conditions tab already produces, as opposed to the frequent words
// nothing produces yet.
type Filter = "all" | "conditions" | "frequent";

const FILTER_LABELS: Record<Filter, TranslationKey> = {
  all: "autoTag.filter.all",
  conditions: "autoTag.tab.conditions",
  frequent: "autoTag.filter.frequent",
};

const filterOf = (c: Candidate): Exclude<Filter, "all"> =>
  candidateGroup(c) === "frequent" ? "frequent" : "conditions";

/** For a candidate the screen has no state for; none is expected. */
const NOT_PENDING: CandidateState = {
  ignored: false,
  inKeywords: false,
  canRegister: false,
  missing: 0,
  tagged: 0,
  pending: false,
};

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

  const counts: Record<Filter, number> = {
    all: candidates.length,
    conditions: 0,
    frequent: 0,
  };
  for (const c of candidates) counts[filterOf(c)]++;
  const shown = candidates.filter(
    (c) => filter === "all" || filterOf(c) === filter,
  );
  const paging = usePaging("suggest.page", filter, shown.length);
  const pendingShown = shown.filter((c) => stateOf(c).pending);
  const picked = pendingShown.filter((c) => selected.has(c.key));
  const allChecked =
    pendingShown.length > 0 && picked.length === pendingShown.length;
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
        const entry = newKeyword(keywords, cand.name, []);
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
          if (newKeyword(merged, entry.tag, [])) merged = [...merged, entry];
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

  const restore = (c: Candidate) => {
    update((cfg) => ({
      ...cfg,
      ignored: cfg.ignored.filter((key) => key !== c.key),
    }));
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
                candidates: candidates.length,
                pending: pendingTotal,
              })}
        </span>
        <Segmented
          tone="bg"
          label={t("autoTag.filter.label")}
          value={filter}
          onChange={setFilter}
          options={(["all", "conditions", "frequent"] as const).map(
            (value) => ({
              value,
              label: t(FILTER_LABELS[value]),
              count: counts[value],
            }),
          )}
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
        <div className="sticky top-0 z-[1] grid grid-cols-[28px_minmax(120px,1.4fr)_minmax(72px,1fr)_56px_minmax(0,auto)] items-center gap-x-3 border-b border-border bg-bg px-3 py-1.5 text-[11px] text-muted">
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
          <span>{t("autoTag.col.origin")}</span>
          <span className="text-right">{t("autoTag.col.files")}</span>
          <span />
        </div>
        {shown.slice(paging.start, paging.end).map((c) => {
          const at = stateOf(c);
          const open = expanded === c.key;
          return (
            <div
              key={c.key}
              className={cn(
                "border-b border-surface",
                at.ignored && "opacity-45",
              )}
            >
              <div className="grid grid-cols-[28px_minmax(120px,1.4fr)_minmax(72px,1fr)_56px_minmax(0,auto)] items-center gap-x-3 px-3 py-2 hover:bg-fg/5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  aria-label={c.name}
                  disabled={!at.pending}
                  checked={at.pending && selected.has(c.key)}
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
                <span className="flex flex-wrap gap-1">
                  {c.origins.map((origin) => (
                    <Badge key={origin}>{t(ORIGIN_LABELS[origin])}</Badge>
                  ))}
                </span>
                <span className="text-right text-xs tabular-nums text-fg">
                  {c.count}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {/* Whatever was done with it: looking at the files is how
                      one decides, and how one checks afterwards. */}
                  <button
                    type="button"
                    onClick={() => searchInLibrary(c)}
                    title={t("autoTag.searchCandidateHint")}
                    aria-label={t("autoTag.searchFor", { tag: c.name })}
                    className="flex size-[26px] shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-fg/10 hover:text-bright-fg"
                  >
                    <Search className="size-3.5" />
                  </button>
                  {at.ignored ? (
                    <>
                      <span className="whitespace-nowrap text-xs text-muted">
                        {t("autoTag.status.ignored")}
                      </span>
                      <button
                        type="button"
                        onClick={() => restore(c)}
                        className="h-[26px] px-2 text-xs text-muted underline underline-offset-2 hover:text-bright-fg"
                      >
                        {t("autoTag.revert")}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* The two facts side by side, each as what it is now:
                          in the keywords or not, on the files or not — the
                          latter as the way to take it off them again. */}
                      {at.inKeywords && (
                        <span className="whitespace-nowrap text-xs text-primary">
                          {t("autoTag.status.registered")}
                        </span>
                      )}
                      {at.tagged > 0 && (
                        <SmallButton
                          variant="ghost"
                          className="h-[26px] px-2"
                          disabled={busy}
                          title={t("autoTag.removeHint")}
                          onClick={() => void remove(c)}
                        >
                          {t("autoTag.removeFromFiles", { count: at.tagged })}
                        </SmallButton>
                      )}
                      {/* Registering is the main action where it applies:
                          the tag then keeps being applied by the Conditions
                          tab's keywords instead of this once — and it is
                          offered for as long as they do not have it, whether
                          or not the files are tagged already. */}
                      {at.canRegister && (
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
                      )}
                      {/* In the keywords does not mean on the files: those
                          already in the library only get the tag from a scan,
                          a re-apply — or here. */}
                      {at.missing > 0 && (
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
                      )}
                      {at.pending && (
                        <SmallButton
                          variant="ghost"
                          className="h-[26px] px-2"
                          onClick={() => ignore([c])}
                        >
                          {t("autoTag.ignore")}
                        </SmallButton>
                      )}
                    </>
                  )}
                </span>
              </div>
              {open && (
                <div className="flex flex-col gap-0.5 pb-2.5 pl-14 pr-3">
                  {[...c.files.entries()]
                    .slice(0, MAX_EXPANDED_FILES)
                    .map(([index, ranges]) => (
                      <div
                        key={index}
                        className={cn(MONO, "break-all py-0.5 text-xs text-fg")}
                      >
                        <Highlighted segs={segments(names[index], ranges)} />
                      </div>
                    ))}
                  <MoreRows t={t} hidden={c.files.size - MAX_EXPANDED_FILES} />
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="p-8 text-center text-[13px] text-muted">
            {state.loading ? t("autoTag.analyzing") : t("autoTag.noCandidates")}
          </p>
        )}
      </TabScroll>
      <Pager t={t} paging={paging} />

      {picked.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2">
          <span className="text-xs text-fg">
            {t("autoTag.selection", {
              count: picked.length,
              files: filesOf(picked),
            })}
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
          <SmallButton
            variant={picked.some(canRegister) ? "outline" : "primary"}
            disabled={busy}
            onClick={() => void apply(picked, false)}
          >
            {t("autoTag.applySelected")}
          </SmallButton>
          <SmallButton variant="ghost" onClick={() => ignore(picked)}>
            {t("autoTag.ignore")}
          </SmallButton>
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
