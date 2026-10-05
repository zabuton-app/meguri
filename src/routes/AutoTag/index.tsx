// Auto-tagging. /auto-tag. Rules and a keyword dictionary that tag files from
// their names, and three ways to bring an existing library in line with them:
// suggestions, a file-by-file review, and sorting the library's own vocabulary.
// Overlays the library as a modal, like /tags and /history.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import { suggestCandidates } from "@shared/autoTagAnalysis";
import { KeywordsTab } from "./KeywordsTab";
import { ReviewTab } from "./ReviewTab";
import { RulesTab } from "./RulesTab";
import { isApplied } from "./helpers";
import { useAutoTagSession } from "./session";
import { SuggestTab } from "./SuggestTab";
import { TermsTab } from "./TermsTab";
import { useAutoTag } from "./useAutoTag";

const TABS = ["rules", "keywords", "suggest", "review", "terms"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, TranslationKey> = {
  rules: "autoTag.tab.rules",
  keywords: "autoTag.tab.keywords",
  suggest: "autoTag.tab.suggest",
  review: "autoTag.tab.review",
  terms: "autoTag.tab.terms",
};

/** A word has to be in this many files before it is suggested on its own. */
const MIN_FREQUENCY = 2;

export default function AutoTag() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const onClose = useCallback(() => {
    void navigate("/");
  }, [navigate]);
  const [tab, setTab] = useState<TabId>("rules");
  const state = useAutoTag();
  const session = useAutoTagSession(state?.generation ?? 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A nested layer (the confirm dialog, the review tab's token panel)
      // calls preventDefault on the Escape it consumed.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const engine = state?.engine;
  const names = state?.names;
  const stop = state?.stop;
  const candidates = useMemo(
    () =>
      engine && names && stop
        ? suggestCandidates(engine, names, { minFreq: MIN_FREQUENCY, stop })
        : [],
    [engine, names, stop],
  );
  const pending = useMemo(() => {
    if (!state) return 0;
    const ignored = new Set(state.config.ignored);
    return candidates.filter(
      (c) => !ignored.has(c.key) && !isApplied(c, state.fileTags),
    ).length;
  }, [candidates, state]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auto-tag-title"
    >
      <div
        className="relative flex h-[min(880px,calc(100vh-48px))] min-h-[min(620px,100%)] w-full max-w-[1160px] flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="size-2 rounded-sm bg-primary" />
          <span id="auto-tag-title" className="text-sm font-medium text-fg">
            {t("autoTag.title")}
          </span>
          {state && (
            <span className="text-xs text-muted">
              {t("autoTag.summary", {
                rules: state.config.rules.filter((r) => r.enabled).length,
                keywords: state.config.keywords.length,
                files: state.total,
              })}
              {state.total > state.files.length &&
                ` ${t("autoTag.sampled", { count: state.files.length })}`}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            title={`${t("common.close")} (Esc)`}
            aria-label={t("common.close")}
            className="ml-auto flex h-7 items-center rounded-md px-2 text-fg transition hover:bg-fg/10 hover:text-bright-fg"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="shrink-0 border-b border-border">
          <div
            role="tablist"
            aria-label={t("autoTag.title")}
            className="no-scrollbar -mb-px flex gap-1 overflow-x-auto overflow-y-hidden px-3"
          >
            {TABS.map((id) => {
              const active = id === tab;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`auto-tag-tab-${id}`}
                  aria-selected={active}
                  aria-controls="auto-tag-panel"
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition",
                    active
                      ? "border-primary font-medium text-bright-fg"
                      : "border-transparent text-muted hover:text-fg",
                  )}
                >
                  {t(TAB_LABELS[id])}
                  {id === "suggest" && pending > 0 && (
                    <span className="rounded-full bg-overlay px-[5px] text-[10px] leading-[14px] tabular-nums text-bright-fg">
                      {pending}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {state?.safeMode && (
          <div
            role="alert"
            className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-warn/10 px-3 py-2 text-xs text-warn"
          >
            <span>{t("autoTag.safeMode")}</span>
            <button
              type="button"
              onClick={state.leaveSafeMode}
              className="rounded-md border border-warn/50 px-2 py-0.5 text-bright-fg hover:bg-warn/20"
            >
              {t("autoTag.safeModeResume")}
            </button>
          </div>
        )}

        <div
          role="tabpanel"
          id="auto-tag-panel"
          aria-labelledby={`auto-tag-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {!state ? (
            <p className="p-8 text-center text-[13px] text-muted">
              {t("autoTag.loading")}
            </p>
          ) : tab === "rules" ? (
            <RulesTab state={state} />
          ) : tab === "keywords" ? (
            <KeywordsTab state={state} />
          ) : tab === "suggest" ? (
            <SuggestTab
              state={state}
              session={session}
              candidates={candidates}
            />
          ) : tab === "review" ? (
            <ReviewTab state={state} session={session} />
          ) : (
            <TermsTab state={state} session={session} candidates={candidates} />
          )}
        </div>
      </div>
    </div>
  );
}
