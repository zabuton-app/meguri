// What the pet says at one step of a tour, with the controls to move through
// it. Drawn over the pet's head while the pet is out; with the pet put away
// it floats at the bottom of the window instead (see TourProvider).
import { useEffect, useLayoutEffect, useRef } from "react";
import { LANGUAGES, useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTour } from "./TourProvider";

const TOUR_BUBBLE_TITLE_ID = "tour-bubble-title";
const TOUR_BUBBLE_BODY_ID = "tour-bubble-body";
/** Gap kept from the window edges, in px. */
const EDGE_GAP = 8;

export function TourBubble({ placement }: { placement: "pet" | "floating" }) {
  const { t, lang, setLang } = useI18n();
  const tour = useTour();
  const step = tour.step;
  const rootRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Over the pet the bubble is centred on it, which can push it past a window
  // edge: nudge it back in.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || placement !== "pet") return;
    // The centring itself is the class's `translate`, which an inline value
    // replaces: measure with the class alone, then keep its -50% in the sum.
    el.style.translate = "";
    const rect = el.getBoundingClientRect();
    const overLeft = EDGE_GAP - rect.left;
    const overRight = rect.right - (window.innerWidth - EDGE_GAP);
    const shift = overLeft > 0 ? overLeft : overRight > 0 ? -overRight : 0;
    if (shift !== 0) el.style.translate = `calc(-50% + ${shift}px) 0`;
  }, [placement, step?.index]);

  // Each step hands the keyboard to its Next button.
  useEffect(() => {
    nextRef.current?.focus();
  }, [step?.index]);

  if (!step) return null;
  const isFirst = step.index === 0;
  const isLast = step.index === step.total - 1;

  return (
    <div
      ref={rootRef}
      data-tour-bubble=""
      role="dialog"
      aria-modal="true"
      aria-labelledby={TOUR_BUBBLE_TITLE_ID}
      aria-describedby={TOUR_BUBBLE_BODY_ID}
      className={cn(
        "w-72 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg shadow-black/25",
        placement === "pet"
          ? "absolute bottom-full left-1/2 mb-2 -translate-x-1/2"
          : "fixed bottom-6 left-1/2 z-[10001] -translate-x-1/2",
      )}
    >
      <p id={TOUR_BUBBLE_TITLE_ID} className="font-semibold text-bright-fg">
        {t(step.title)}
      </p>
      <p id={TOUR_BUBBLE_BODY_ID} className="mt-1 text-xs leading-relaxed">
        {t(step.body)}
      </p>
      {step.picker === "language" && (
        // Plain buttons rather than the settings' Select: its menu would open
        // in a portal under the tour's overlay. Each name is in its own
        // language; the choice is stored like the one made in Settings.
        <div
          role="group"
          aria-label={t("settings.language")}
          className="mt-2 grid grid-cols-2 gap-1.5"
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              lang={l.id}
              aria-pressed={lang === l.id}
              onClick={() => setLang(l.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                lang === l.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-bg text-muted hover:text-fg",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-muted" aria-live="polite">
          {t("tour.progress", {
            current: step.index + 1,
            total: step.total,
          })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {!isLast && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={tour.skip}
            >
              {t("tour.skip")}
            </Button>
          )}
          {!isFirst && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={tour.prev}
            >
              {t("tour.prev")}
            </Button>
          )}
          <Button
            ref={nextRef}
            size="sm"
            className="h-7 px-2"
            onClick={tour.next}
          >
            {isLast ? t("tour.done") : t("tour.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
