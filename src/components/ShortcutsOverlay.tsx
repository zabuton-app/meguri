// Keyboard-shortcuts cheat sheet, opened with "?". Rows whose keys come from the
// active keybinding preset are built from it and marked with a dot; the rest are
// fixed keys, kept by hand in step with each screen's key handler.
import { Fragment, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n/I18nProvider";
import { usePreferences } from "@/settings/PreferencesProvider";
import { isTyping } from "@/lib/keyTarget";
import {
  NAV_BINDINGS,
  GRID_BINDINGS,
  chordCaps,
  isHelpKey,
  type KeyChord,
} from "@/settings/keybindings";

/** Keys pressed together, one keycap each: ["Ctrl", "K"]. */
type Combo = string[];
/** One way to trigger a row. Several combos are a set such as previous / next. */
type KeyGroup = Combo[];

interface Row {
  label: string;
  /** Alternatives, shown joined by "or". */
  keys: KeyGroup[];
  /** The keys change with the keybinding preset (keys every preset shares,
   *  such as Enter, are not marked). */
  preset?: boolean;
}

interface SectionData {
  id: string;
  title: string;
  hint?: string;
  rows: Row[];
}

/** Each chord is an alternative of its own. */
function alts(chords: KeyChord[]): KeyGroup[] {
  return chords.map((c) => [chordCaps(c)]);
}

/** Lists of chords zipped by position, e.g. prev/next → "h / l". */
function zipChords(...lists: KeyChord[][]): KeyGroup[] {
  return lists[0].map((_, i) =>
    lists.flatMap((l) => (l[i] ? [chordCaps(l[i])] : [])),
  );
}

const sectionDomId = (id: string) => `shortcuts-${id}`;

/** What the filter searches. Keys are written both "ctrl 0" and "ctrl+0". */
function rowText(r: Row): string {
  const keys = r.keys.map((group) =>
    group.map((c) => `${c.join(" ")} ${c.join("+")}`).join(" "),
  );
  return [r.label, ...keys].join(" ").toLowerCase();
}

export function ShortcutsOverlay({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { keybindingPreset } = usePreferences();
  const [query, setQuery] = useState("");
  const b = NAV_BINDINGS[keybindingPreset];
  const g = GRID_BINDINGS[keybindingPreset];

  // Close on Esc or "?". Capture phase so it preempts a detail modal's Esc handler underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // "?" is a character the filter may be asked to find.
      if (e.key === "Escape" || (isHelpKey(e) && !isTyping())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const W: KeyGroup[] = [[["W"]]];
  const esc: KeyGroup[] = [[["Esc"]]];
  const arrowsLR: KeyGroup[] = [[["←"], ["→"]]];

  const all: SectionData[] = [
    {
      id: "general",
      title: t("shortcuts.sectionGeneral"),
      hint: t("shortcuts.hintGeneral"),
      rows: [
        { label: t("shortcuts.commandMenu"), keys: [[["Ctrl", "K"]]] },
        { label: t("shortcuts.help"), keys: [[["?"]]] },
        {
          label: t("shortcuts.zoom"),
          keys: [
            [
              ["Ctrl", "+"],
              ["Ctrl", "-"],
            ],
          ],
        },
        { label: t("shortcuts.zoomReset"), keys: [[["Ctrl", "0"]]] },
      ],
    },
    {
      id: "list",
      title: t("shortcuts.sectionList"),
      hint: t("shortcuts.hintList"),
      rows: [
        {
          label: t("shortcuts.search"),
          keys: alts(b.focusSearch),
          preset: true,
        },
        {
          label: t("shortcuts.moveFocus"),
          keys: zipChords(g.up, g.down, g.left, g.right),
          preset: true,
        },
        { label: t("shortcuts.openFocused"), keys: alts(g.open) },
        { label: t("shortcuts.inspectFocused"), keys: alts(g.inspect) },
        {
          label: t("shortcuts.scrollDown"),
          keys: alts(b.pageDown),
          preset: true,
        },
        { label: t("shortcuts.scrollUp"), keys: alts(b.pageUp), preset: true },
        { label: t("shortcuts.watchLater"), keys: W },
        {
          label: t("shortcuts.fileMenu"),
          keys: [[["Shift", "F10"]], [["Menu"]]],
        },
        { label: t("shortcuts.selectAll"), keys: [[["Ctrl", "A"]]] },
        { label: t("shortcuts.bulkTags"), keys: [[["T"]]] },
        {
          label: t("shortcuts.folderBack"),
          keys: [[["Alt", "←"]], [["Backspace"]]],
        },
        { label: t("shortcuts.folderUp"), keys: [[["Alt", "↑"]]] },
      ],
    },
    {
      id: "detail",
      title: t("shortcuts.sectionDetail"),
      hint: t("shortcuts.hintDetail"),
      rows: [
        { label: t("media.prev"), keys: alts(b.prev), preset: true },
        { label: t("media.next"), keys: alts(b.next), preset: true },
        { label: t("shortcuts.imagePaging"), keys: arrowsLR },
        {
          label: t("shortcuts.imageZoom"),
          keys: [[["Ctrl", t("shortcuts.wheel")]]],
        },
        {
          label: t("shortcuts.imageZoomToggle"),
          keys: [[[t("shortcuts.doubleClick")]]],
        },
        { label: t("shortcuts.watchLater"), keys: W },
        { label: t("common.close"), keys: esc },
      ],
    },
    {
      id: "playback",
      title: t("shortcuts.sectionPlayback"),
      hint: t("shortcuts.hintPlayback"),
      rows: [
        { label: t("shortcuts.playPause"), keys: [[["Space"]], [["K"]]] },
        { label: t("shortcuts.skip5"), keys: arrowsLR },
        { label: t("shortcuts.skip10"), keys: [[["J"], ["L"]]] },
        { label: t("shortcuts.volume"), keys: [[["↑"], ["↓"]]] },
        { label: t("shortcuts.mute"), keys: [[["M"]]] },
        { label: t("shortcuts.speed"), keys: [[["<"], [">"]]] },
        { label: t("shortcuts.fullscreen"), keys: [[["F"]]] },
        { label: t("shortcuts.seekStart"), keys: [[["Home"]], [["0"]]] },
        {
          label: t("shortcuts.spectrumPattern"),
          keys: [[["V"]], [["Shift", "V"]]],
        },
      ],
    },
    {
      id: "player",
      title: t("shortcuts.sectionPlayer"),
      hint: t("shortcuts.hintPlayer"),
      rows: [
        {
          label: t("shortcuts.playerPrevNext"),
          keys: [[["P"], ["N"]], ...zipChords(b.prev, b.next)],
          preset: true,
        },
        { label: t("shortcuts.playerArrows"), keys: arrowsLR },
        { label: t("shortcuts.shuffle"), keys: [[["S"]]] },
        { label: t("shortcuts.playerDetail"), keys: [[["I"]]] },
        { label: t("shortcuts.fullscreen"), keys: [[["F"]]] },
        { label: t("shortcuts.playerExit"), keys: esc },
      ],
    },
    {
      id: "discover",
      title: t("shortcuts.sectionDiscover"),
      hint: t("shortcuts.hintDiscover"),
      rows: [
        {
          label: t("shortcuts.discoverPaging"),
          keys: [...zipChords(b.prev, b.next), ...arrowsLR],
          preset: true,
        },
        { label: t("shortcuts.discoverReshuffle"), keys: [[["R"]]] },
        { label: t("shortcuts.watchLater"), keys: W },
        { label: t("common.close"), keys: esc },
      ],
    },
    {
      id: "compare",
      title: t("shortcuts.sectionCompare"),
      rows: [
        {
          label: t("shortcuts.compareModes"),
          keys: [[["1"], ["2"], ["3"], ["4"]]],
        },
        { label: t("shortcuts.compareSwap"), keys: [[["S"]]] },
        { label: t("shortcuts.compareZoom"), keys: [[["+"], ["-"]]] },
        { label: t("shortcuts.compareFit"), keys: [[["0"]]] },
        { label: t("shortcuts.compareBlink"), keys: [[["Space"]]] },
        { label: t("common.close"), keys: esc },
      ],
    },
    {
      id: "graph",
      title: t("shortcuts.sectionGraph"),
      rows: [
        { label: t("shortcuts.graphFit"), keys: [[["F"]]] },
        { label: t("shortcuts.graphSearch"), keys: [[["G"]]] },
        { label: t("shortcuts.graphClear"), keys: esc },
      ],
    },
  ];

  const q = query.trim().toLowerCase();
  const sections = all
    .map((s) => ({
      ...s,
      rows: q ? s.rows.filter((r) => rowText(r).includes(q)) : s.rows,
    }))
    .filter((s) => s.rows.length > 0);

  const openSettings = () => {
    onOpenSettings();
    onClose();
  };

  return (
    <div
      className="modal-backdrop z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        data-slot="modal-panel"
        className="relative flex h-[min(720px,85vh)] w-full max-w-[980px] flex-col overflow-hidden rounded-window border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2
              id="shortcuts-title"
              className="text-base font-semibold text-bright-fg"
            >
              {t("shortcuts.title")}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span>{t("shortcuts.preset")}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 font-semibold text-primary">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-primary"
                />
                {t(`keybinding.${keybindingPreset}`)}
              </span>
              <span>{t("shortcuts.presetNote")}</span>
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={openSettings}
              >
                {t("shortcuts.presetChange")}
              </button>
            </div>
          </div>
          <label className="flex h-9 w-64 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-muted focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0" />
            <span className="sr-only">{t("shortcuts.filterLabel")}</span>
            <input
              type="search"
              value={query}
              placeholder={t("shortcuts.filterPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-bright-fg outline-none placeholder:text-muted"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onClose}
            title={`${t("common.close")} (Esc)`}
            aria-label={t("common.close")}
          >
            <X />
          </Button>
        </header>

        {sections.length > 0 && (
          <nav
            aria-label={t("shortcuts.sectionsLabel")}
            className="flex flex-wrap gap-1.5 border-b border-border px-5 pb-3"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-surface px-2.5 text-xs font-medium text-fg hover:bg-accent"
                onClick={() =>
                  document
                    .getElementById(sectionDomId(s.id))
                    ?.scrollIntoView?.({ block: "start" })
                }
              >
                {s.title}
                <span className="tabular-nums text-muted">{s.rows.length}</span>
              </button>
            ))}
          </nav>
        )}

        {/* The sheet has a fixed height, but the viewport cannot take a
            percentage height from a flex item: make the scroll area a flex
            column and let the viewport shrink as a flex item instead. */}
        <ScrollArea
          className="flex min-h-0 flex-1 flex-col"
          viewportClassName="min-h-0 flex-1 px-5 py-4"
        >
          {sections.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-16 text-center text-sm text-muted">
              <span className="font-medium text-fg">
                {t("shortcuts.noMatch", { query: query.trim() })}
              </span>
              <span>{t("shortcuts.noMatchHint")}</span>
            </div>
          ) : (
            <div className="gap-8 md:columns-2">
              {sections.map((s) => (
                <Section key={s.id} section={s} or={t("shortcuts.or")} />
              ))}
            </div>
          )}
        </ScrollArea>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-5 py-2.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>?</Kbd>
            {t("shortcuts.or")}
            <Kbd>Esc</Kbd>
            {t("shortcuts.toClose")}
          </span>
          <span className="ml-auto">{t("shortcuts.macNote")}</span>
        </footer>
      </div>
    </div>
  );
}

function Section({ section, or }: { section: SectionData; or: string }) {
  return (
    <section
      id={sectionDomId(section.id)}
      className="mb-6 break-inside-avoid"
      aria-labelledby={`${sectionDomId(section.id)}-title`}
    >
      <h3
        id={`${sectionDomId(section.id)}-title`}
        className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-primary"
      >
        {section.title}
        {section.hint && (
          <span className="font-normal normal-case tracking-normal text-muted">
            {section.hint}
          </span>
        )}
      </h3>
      <ul className="flex flex-col">
        {section.rows.map((r, i) => (
          <li
            key={i}
            className="-mx-2 flex min-h-8 items-center justify-between gap-4 rounded-md px-2 py-0.5 hover:bg-surface"
          >
            <span className="flex items-center gap-2 text-sm text-fg">
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${r.preset ? "bg-primary" : ""}`}
              />
              {r.label}
            </span>
            <span className="flex shrink-0 items-center justify-end gap-1.5">
              {r.keys.map((group, j) => (
                <Fragment key={j}>
                  {j > 0 && <span className="text-xs text-muted">{or}</span>}
                  <span className="inline-flex items-center gap-1">
                    {group.map((combo, k) => (
                      <Fragment key={k}>
                        {k > 0 && <span className="text-xs text-muted">/</span>}
                        <span className="inline-flex gap-0.5">
                          {combo.map((cap, m) => (
                            <Kbd key={m}>{cap}</Kbd>
                          ))}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                </Fragment>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 border-border-strong bg-surface px-1.5 font-mono text-xs text-bright-fg">
      {children}
    </kbd>
  );
}
