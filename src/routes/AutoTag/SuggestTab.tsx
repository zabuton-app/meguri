// Suggestions tab: every tag the engine would give the files in scope, plus
// frequent words it does not pick up yet — to apply, register or dismiss.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { searchLibrary } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import { MAX_AUTO_TAG_KEYWORDS } from "@shared/autoTag";
import { anyOfSearchToken } from "@shared/tags";
import {
  candidateGroup,
  segments,
  type Candidate,
  type CandidateGroup,
  type CandidateOrigin,
} from "@shared/autoTagAnalysis";
import { isAutoMetaValue } from "./autoMeta";
import { MAX_ROWS, MONO, isApplied, newKeyword } from "./helpers";
import {
  Badge,
  Chip,
  Highlighted,
  MoreRows,
  Notice,
  Segmented,
  SmallButton,
  TabScroll,
  Toolbar,
} from "./parts";
import type { AutoTagSession } from "./session";
import type { AutoTagState } from "./useAutoTag";

const ORIGIN_LABELS: Record<CandidateOrigin, TranslationKey> = {
  prefix: "autoTag.kind.prefix",
  bracket: "autoTag.kind.bracket",
  regex: "autoTag.kind.regex",
  keyword: "autoTag.origin.keyword",
  frequent: "autoTag.origin.frequent",
};

type Filter = "all" | CandidateGroup;

const FILTER_LABELS: Record<Filter, TranslationKey> = {
  all: "autoTag.filter.all",
  rule: "autoTag.filter.rule",
  keyword: "autoTag.filter.keyword",
  frequent: "autoTag.filter.frequent",
};

/** Files shown when a candidate is expanded. */
const MAX_EXPANDED_FILES = 50;

export function SuggestTab({
  state,
  session,
  candidates,
}: {
  state: AutoTagState;
  session: AutoTagSession;
  candidates: Candidate[];
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { config, update, fileTags, existing, names } = state;
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const { done, setDone } = session;
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const ignored = useMemo(() => new Set(config.ignored), [config.ignored]);
  const dictionary = useMemo(
    () => new Set(config.keywords.map((k) => k.tag.toLowerCase())),
    [config.keywords],
  );

  type Status = "pending" | "applied" | "dict" | "ignored";
  const statusOf = (c: Candidate): Status => {
    const session = done.get(c.key);
    if (session) return session.dict ? "dict" : "applied";
    if (ignored.has(c.key)) return "ignored";
    return isApplied(c, fileTags) ? "applied" : "pending";
  };

  const counts: Record<Filter, number> = {
    all: candidates.length,
    rule: 0,
    keyword: 0,
    frequent: 0,
  };
  for (const c of candidates) counts[candidateGroup(c)]++;
  const shown = candidates.filter(
    (c) => filter === "all" || candidateGroup(c) === filter,
  );
  const pendingShown = shown.filter((c) => statusOf(c) === "pending");
  const picked = pendingShown.filter((c) => selected.has(c.key));
  const allChecked =
    pendingShown.length > 0 && picked.length === pendingShown.length;
  const filesOf = (list: Candidate[]): number => {
    const set = new Set<number>();
    for (const c of list) for (const index of c.files.keys()) set.add(index);
    return set.size;
  };

  // Worth a dictionary entry: nothing in "Rules and dictionary" produces it yet.
  // A candidate that comes from a rule or from the dictionary is already
  // managed there, so for those applying is all there is to do.
  const canRegister = (c: Candidate): boolean =>
    candidateGroup(c) === "frequent" &&
    !dictionary.has(c.key) &&
    config.keywords.length < MAX_AUTO_TAG_KEYWORDS;

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
    // One apply per candidate, so each row can be taken back on its own.
    const next = new Map(done);
    const applied: Candidate[] = [];
    const registered: Candidate[] = [];
    let files = 0;
    for (const cand of list) {
      const perFile = new Map<number, string[]>();
      for (const index of cand.files.keys()) perFile.set(index, [cand.name]);
      const outcome = await state.apply(perFile);
      // A failure was reported already; the rest of the batch would only fail
      // the same way, and nothing that did not happen is marked as done.
      if (!outcome.ok) break;
      files += outcome.files;
      applied.push(cand);
      const registers = dict && canRegister(cand);
      if (registers) registered.push(cand);
      next.set(cand.key, { dict: registers, undo: outcome.undo });
    }
    if (registered.length > 0) {
      update((c) => {
        let keywords = c.keywords;
        for (const cand of registered) {
          const entry = newKeyword(keywords, cand.name, []);
          if (entry) keywords = [...keywords, entry];
        }
        return { ...c, keywords };
      });
    }
    setDone(next);
    setSelected(new Set());
    setNotice(
      applied.length === 0
        ? ""
        : (applied.length === 1
            ? t("autoTag.appliedOne", { tag: applied[0].name, files })
            : t("autoTag.appliedMany", { tags: applied.length, files })) +
            (registered.length > 0 ? t("autoTag.appliedDictSuffix") : ""),
    );
    setBusy(false);
  };

  const ignore = (list: Candidate[]) => {
    const keys = list.map((c) => c.key);
    update((c) => ({ ...c, ignored: [...new Set([...c.ignored, ...keys])] }));
    setSelected(new Set());
  };

  const revert = async (c: Candidate) => {
    const session = done.get(c.key);
    if (session?.undo) await state.undo(session.undo);
    if (session) {
      const next = new Map(done);
      next.delete(c.key);
      setDone(next);
    }
    if (ignored.has(c.key)) {
      update((cfg) => ({
        ...cfg,
        ignored: cfg.ignored.filter((key) => key !== c.key),
      }));
    }
    setNotice("");
  };

  const pendingTotal = candidates.filter(
    (c) => statusOf(c) === "pending",
  ).length;

  return (
    <>
      <Toolbar>
        <div className="flex min-w-[220px] flex-[1_1_260px] flex-col gap-1">
          <span className="text-xs text-fg">
            {state.loading
              ? t("autoTag.analyzing")
              : t("autoTag.analyzed", {
                  files: names.length,
                  candidates: candidates.length,
                  pending: pendingTotal,
                })}
          </span>
          <div className="h-1 max-w-[360px] overflow-hidden rounded-sm bg-overlay">
            <div
              className={cn(
                "h-full bg-primary transition-[width]",
                state.loading ? "w-1/3 animate-pulse" : "w-full",
              )}
            />
          </div>
        </div>
        <Segmented
          tone="bg"
          label={t("autoTag.filter.label")}
          value={filter}
          onChange={setFilter}
          options={(["all", "rule", "keyword", "frequent"] as const).map(
            (value) => ({
              value,
              label: t(FILTER_LABELS[value]),
              count: counts[value],
            }),
          )}
        />
        <SmallButton
          disabled={state.loading}
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
        {shown.slice(0, MAX_ROWS).map((c) => {
          const status = statusOf(c);
          const open = expanded === c.key;
          const session = done.get(c.key);
          const canRevert =
            status === "ignored" || (session != null && session.undo != null);
          return (
            <div
              key={c.key}
              className={cn(
                "border-b border-surface",
                status === "ignored" && "opacity-45",
              )}
            >
              <div className="grid grid-cols-[28px_minmax(120px,1.4fr)_minmax(72px,1fr)_56px_minmax(0,auto)] items-center gap-x-3 px-3 py-2 hover:bg-fg/5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  aria-label={c.name}
                  disabled={status !== "pending"}
                  checked={status === "pending" && selected.has(c.key)}
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
                  {status === "pending" ? (
                    <>
                      {/* Registering is the main action where it applies:
                          the tag then keeps being applied by "Rules and
                          dictionary" instead of this once. */}
                      {canRegister(c) && (
                        <SmallButton
                          variant="primary"
                          className="h-[26px]"
                          disabled={busy}
                          onClick={() => void apply([c], true)}
                        >
                          {t("autoTag.addToDictionary")}
                        </SmallButton>
                      )}
                      <SmallButton
                        variant={canRegister(c) ? "outline" : "primary"}
                        className={cn(
                          "h-[26px]",
                          canRegister(c) && "border-border px-2",
                        )}
                        disabled={busy}
                        onClick={() => void apply([c], false)}
                      >
                        {t("autoTag.apply")}
                      </SmallButton>
                      <SmallButton
                        variant="ghost"
                        className="h-[26px] px-2"
                        onClick={() => ignore([c])}
                      >
                        {t("autoTag.ignore")}
                      </SmallButton>
                    </>
                  ) : (
                    <>
                      <span
                        className={cn(
                          "whitespace-nowrap text-xs",
                          status === "ignored" ? "text-muted" : "text-success",
                        )}
                      >
                        {t(
                          status === "ignored"
                            ? "autoTag.status.ignored"
                            : status === "dict"
                              ? "autoTag.status.dict"
                              : "autoTag.status.applied",
                        )}
                      </span>
                      {canRevert && (
                        <button
                          type="button"
                          onClick={() => void revert(c)}
                          className="h-[26px] px-2 text-xs text-muted underline underline-offset-2 hover:text-bright-fg"
                        >
                          {t("autoTag.revert")}
                        </button>
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
        <MoreRows t={t} hidden={shown.length - MAX_ROWS} />
        {shown.length === 0 && (
          <p className="p-8 text-center text-[13px] text-muted">
            {state.loading ? t("autoTag.analyzing") : t("autoTag.noCandidates")}
          </p>
        )}
      </TabScroll>

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
