// Auto-tagging. /auto-tag. Rules and keywords that tag files from
// their names, and suggestions that bring an existing library in line with
// them.
// Overlays the library as a modal, like /tags and /history.
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";
import { suggestCandidates } from "@shared/autoTagAnalysis";
import { ConditionsTab } from "./ConditionsTab";
import {
  candidateContext,
  candidateState,
  type CandidateState,
} from "./helpers";
import { SuggestTab } from "./SuggestTab";
import { useAutoTag } from "./useAutoTag";
import { useViewState } from "./viewState";

const TABS = ["conditions", "suggest"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, TranslationKey> = {
  conditions: "autoTag.tab.conditions",
  suggest: "autoTag.tab.suggest",
};

// Per screen, like the Tags and History modals' own.
const MODAL_SIZE_KEY = "meguri.autoTag.modalSize";

/** A word has to be in this many files before it is suggested on its own. */
const MIN_FREQUENCY = 2;

export default function AutoTag() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const onClose = useCallback(() => {
    void navigate("/");
  }, [navigate]);
  // "small" is the centred panel; "large" fills the window, as the other
  // modals have it.
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "small",
    (raw) => (raw === "large" ? "large" : "small"),
  );
  const isSmall = modalSize === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");
  const [tab, setTab] = useViewState<TabId>("tab", "conditions");
  const state = useAutoTag();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A nested layer (the confirm dialog) calls preventDefault on the
      // Escape it consumed.
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
  // Where each candidate stands, worked out once for the badge and the tab
  // alike, and only again when what it is read from changes: the keywords,
  // the dismissed words, the files' tags.
  const ignored = state?.config.ignored;
  const keywords = state?.config.keywords;
  const fileTags = state?.fileTags;
  const states = useMemo(() => {
    const map = new Map<string, CandidateState>();
    if (!ignored || !keywords || !fileTags) return map;
    const ctx = candidateContext({ ignored, keywords }, fileTags);
    for (const c of candidates) map.set(c.key, candidateState(c, ctx));
    return map;
  }, [candidates, ignored, keywords, fileTags]);
  const pending = useMemo(() => {
    let count = 0;
    for (const at of states.values()) if (at.pending) count++;
    return count;
  }, [states]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/70 backdrop-blur-sm",
        isSmall ? "items-center p-2 sm:p-6" : "p-2 sm:p-4 md:p-6",
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auto-tag-title"
    >
      <div
        className={cn(
          "relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl",
          isSmall &&
            "h-[min(880px,calc(100vh-48px))] min-h-[min(620px,100%)] max-w-[1160px]",
        )}
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
            onClick={() => setModalSize(isSmall ? "large" : "small")}
            title={toggleLabel}
            aria-label={toggleLabel}
            aria-pressed={isSmall}
            className="ml-auto flex h-7 items-center rounded-md px-2 text-fg transition hover:bg-fg/10 hover:text-bright-fg"
          >
            {isSmall ? (
              <Maximize2 className="size-4" />
            ) : (
              <Minimize2 className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            title={`${t("common.close")} (Esc)`}
            aria-label={t("common.close")}
            className="flex h-7 items-center rounded-md px-2 text-fg transition hover:bg-fg/10 hover:text-bright-fg"
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
          ) : tab === "conditions" ? (
            <ConditionsTab state={state} />
          ) : (
            <SuggestTab
              state={state}
              candidates={candidates}
              states={states}
              pending={pending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
