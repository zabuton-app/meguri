// The library search in the title bar, VS Code style: it shows the search on
// screen and opens the command menu over it, where the search is typed.
// The chips stay removable in place, as the conditions a click on a tag adds;
// they look like the menu field's (DraftChips): change the two together.
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { searchDirectiveKey, splitSearchTokens } from "@shared/tags";
import type { SearchQuery } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { commandMenuShortcut } from "@/lib/platform";
import { searchTokenLabel } from "@/lib/tagLabel";
import { joinQueryChips, splitQueryChips } from "@/lib/searchTokens";
import { onHighlightSearchToken, openCommandMenu } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import { SearchChipLabel } from "./SearchChipLabel";

/** How long a chip stays lit after a click on a tag it already holds. */
const HIGHLIGHT_MS = 1200;

export function SearchTrigger({
  value,
  onChange,
}: {
  value: SearchQuery;
  onChange: (q: SearchQuery) => void;
}) {
  const { t } = useI18n();
  const q = value.q ?? "";
  const { chips, text } = splitQueryChips(q);
  const setQ = (next: string) => onChange({ ...value, q: next || undefined });

  // Clicking a tag that is already a condition changes nothing, so Home asks
  // for its chip to light up instead: otherwise the click looks lost.
  // A new object each time, so a second click restarts the timer.
  const [lit, setLit] = useState<{ key: string | null } | null>(null);
  useEffect(
    () =>
      onHighlightSearchToken((token) => {
        // Through the tokenizer first: the sender quotes a value with spaces.
        setLit({ key: searchDirectiveKey(splitSearchTokens(token)[0] ?? "") });
      }),
    [],
  );
  useEffect(() => {
    if (lit === null) return;
    const id = window.setTimeout(() => setLit(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [lit]);

  return (
    <div
      data-tour="search"
      data-slot="search-trigger"
      data-command-menu-anchor=""
      className="relative flex h-8 w-full min-w-0 items-center gap-1 rounded-md border border-border-strong bg-bg px-2 text-sm text-fg transition-colors hover:border-muted"
    >
      {/* Under the rest and covering the box, so a click anywhere but a
          chip's ✗ or the clear button opens the menu. */}
      <button
        type="button"
        onClick={openCommandMenu}
        aria-label={t("filter.openSearch")}
        title={t("filter.searchHint")}
        className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Search className="pointer-events-none relative size-3.5 shrink-0 text-muted" />
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {chips.map((token, i) => {
          const selected =
            lit?.key != null && searchDirectiveKey(token) === lit.key;
          return (
            // The label lets a click through to the button under it; only the
            // ✗ takes its own.
            <span
              key={`${token}-${i}`}
              data-slot="search-chip"
              data-selected={selected ? "true" : undefined}
              title={searchTokenLabel(t, token) ?? undefined}
              className={cn(
                "flex h-5 min-w-0 shrink-0 items-center gap-0.5 rounded py-0 pl-1.5 pr-0.5 text-xs",
                selected ? "bg-primary/25 ring-1 ring-ring" : "bg-fg/10",
              )}
            >
              <SearchChipLabel t={t} token={token} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setQ(
                    joinQueryChips(
                      chips.filter((_, j) => j !== i),
                      text,
                    ),
                  );
                }}
                aria-label={t("home.removeChip")}
                className="pointer-events-auto rounded-full p-0.5 transition hover:bg-fg/15"
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <span className={cn("truncate", !q && "text-muted")}>
          {q ? text : t("filter.searchPlaceholder")}
        </span>
      </span>
      {q ? (
        <button
          type="button"
          onClick={() => setQ("")}
          aria-label={t("filter.clearSearch")}
          title={t("filter.clearSearch")}
          className="relative shrink-0 rounded-full p-0.5 text-muted transition hover:bg-fg/15 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none relative shrink-0 font-sans text-xs text-muted">
          {commandMenuShortcut()}
        </kbd>
      )}
    </div>
  );
}
