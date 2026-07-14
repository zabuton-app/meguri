// Keyboard-shortcuts cheat sheet, opened with "?". Reflects the active keybinding
// preset for the list/detail navigation keys; player keys are fixed.
import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n/I18nProvider";
import { usePreferences } from "@/settings/PreferencesProvider";
import {
  NAV_BINDINGS,
  GRID_BINDINGS,
  formatChords,
} from "@/settings/keybindings";

interface Row {
  label: string;
  keys: string;
}

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { keybindingPreset } = usePreferences();
  const b = NAV_BINDINGS[keybindingPreset];
  const g = GRID_BINDINGS[keybindingPreset];

  // Close on Esc or "?". Capture phase so it preempts a detail modal's Esc handler underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.code === "Slash" && e.shiftKey)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const list: Row[] = [
    { label: t("shortcuts.commandMenu"), keys: "Ctrl+K / Cmd+K" },
    { label: t("shortcuts.search"), keys: formatChords(b.focusSearch) },
    {
      label: t("shortcuts.moveFocus"),
      keys: formatChords([...g.up, ...g.down, ...g.left, ...g.right]),
    },
    { label: t("shortcuts.openFocused"), keys: formatChords(g.open) },
    { label: t("shortcuts.scrollDown"), keys: formatChords(b.pageDown) },
    { label: t("shortcuts.scrollUp"), keys: formatChords(b.pageUp) },
    { label: t("shortcuts.help"), keys: "?" },
  ];
  const detail: Row[] = [
    { label: t("media.prev"), keys: formatChords(b.prev) },
    { label: t("media.next"), keys: formatChords(b.next) },
    { label: t("shortcuts.playPause"), keys: "Space / K" },
    { label: t("shortcuts.skip5"), keys: "← / →" },
    { label: t("shortcuts.skip10"), keys: "J / L" },
    { label: t("shortcuts.volume"), keys: "↑ / ↓" },
    { label: t("shortcuts.mute"), keys: "M" },
    { label: t("shortcuts.fullscreen"), keys: "F" },
    { label: t("shortcuts.seekStart"), keys: "Home / 0" },
    { label: t("common.close"), keys: "Esc" },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2.5">
          <span className="text-sm font-semibold text-bright-fg">
            {t("shortcuts.title")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2"
            onClick={onClose}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </header>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-4 py-4">
          <Section title={t("shortcuts.sectionList")} rows={list} />
          <Section title={t("shortcuts.sectionDetail")} rows={detail} />
        </ScrollArea>
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
        {title}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="text-sm text-fg">{r.label}</span>
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs tabular-nums text-muted">
              {r.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </section>
  );
}
