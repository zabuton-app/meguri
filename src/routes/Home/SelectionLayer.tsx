// Everything that reacts to the selection: the floating bar, the bulk tag
// dialog, the image comparison, and the keys that drive them.
//
// A component of its own because Home provides the selection context and so
// cannot consume it — this sits just inside the provider, where the bar has to
// live anyway (it is positioned against the list area).
import { useCallback, useEffect, useState } from "react";
import { BulkTagDialog } from "@/components/BulkTagDialog";
import { CompareView } from "@/compare/CompareView";
import type { FileRow } from "@/ipc/types";
import { MAX_BULK_FILES } from "@shared/tags";
import { SelectionBar } from "@/components/SelectionBar";
import { canCompare } from "@/compare/canCompare";
import { useSelection } from "@/components/SelectionContext";
import { isSelectAllKey } from "@/hooks/useSelectAllGuard";
import { isTyping } from "@/lib/keyTarget";

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
  // The pair is kept as it was when the view opened: the selection can change
  // underneath (a refresh after an edit elsewhere), the view should not.
  const [comparing, setComparing] = useState<
    readonly [FileRow, FileRow] | null
  >(null);

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
      // No check for the comparison here: it is an immersive view, which
      // turns `active` off (Home's navActive), and this listener with it.
      if (isTyping() || tagsOpen) return;

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
        onCompare={() => {
          if (canCompare(selection))
            setComparing([selection.rows[0], selection.rows[1]]);
        }}
        onExit={exitSelection}
      />
      {comparing && (
        <CompareView rows={comparing} onClose={() => setComparing(null)} />
      )}
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
