// Everything that reacts to the selection: the floating bar, the bulk tag
// dialog, and the keys that drive both.
//
// A component of its own because Home provides the selection context and so
// cannot consume it — this sits just inside the provider, where the bar has to
// live anyway (it is positioned against the list area).
import { useCallback, useEffect, useState } from "react";
import { BulkTagDialog } from "@/components/BulkTagDialog";
import { MAX_BULK_FILES } from "@shared/tags";
import { SelectionBar } from "@/components/SelectionBar";
import { useSelection } from "@/components/SelectionContext";
import { isSelectAllKey } from "@/hooks/useSelectAllGuard";

interface Props {
  /**
   * Whether the list is the foreground surface. The keys below are off while a
   * modal route or overlay is up, so Ctrl+A keeps meaning "select all text" in
   * whatever is actually on screen.
   */
  active: boolean;
}

export function SelectionLayer({ active }: Props) {
  const selection = useSelection();
  const [tagsOpen, setTagsOpen] = useState(false);

  // Leaving selection mode closes the dialog with it: keeping it open over an
  // empty selection, or having it reappear the next time selection mode starts,
  // are both worse than closing here.
  const exitSelection = useCallback(() => {
    setTagsOpen(false);
    selection.exit();
  }, [selection]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing || tagsOpen) return;

      // Shared with useSelectAllGuard, which suppresses the browser default
      // for the same chord: matching on the produced character rather than the
      // physical key is what makes it work on AZERTY (where "a" sits on KeyQ).
      if (isSelectAllKey(e)) {
        e.preventDefault();
        selection.selectAll();
        return;
      }
      if (!selection.active) return;
      if (e.key === "Escape") {
        // Claims this Esc so Home's close-to-tray handler stands down: it
        // defers past the other listeners and checks defaultPrevented.
        e.preventDefault();
        exitSelection();
        return;
      }
      // Character first, for the same reason; `code` is the fallback only when
      // the event carries no character at all (IME, dead keys).
      const isTagKey =
        e.key === "t" ||
        e.key === "T" ||
        (e.key.length !== 1 && e.code === "KeyT");
      if (isTagKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Not while a picked folder is still fetching its files, nor past
        // the cap: the dialog would open onto an edit it cannot apply.
        if (
          selection.count === 0 ||
          selection.pending ||
          selection.count > MAX_BULK_FILES
        )
          return;
        e.preventDefault();
        setTagsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selection, exitSelection, tagsOpen]);

  return (
    <>
      <SelectionBar
        onEditTags={() => setTagsOpen(true)}
        onExit={exitSelection}
      />
      {/* Mounted only while open so each pass starts from a clean staged edit. */}
      {tagsOpen && (
        <BulkTagDialog
          open
          onOpenChange={setTagsOpen}
          rows={selection.rows}
          onApplied={selection.refresh}
        />
      )}
    </>
  );
}
