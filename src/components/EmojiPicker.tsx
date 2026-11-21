// Emoji picker dialog built on emoji-mart, themed/localized to match the app.
// Used to set the icon of a workspace or collection. It is a modal dialog (not a
// popover) opened from a context menu — a popover anchored to the trigger gets
// dismissed instantly by the closing context menu's pointer/focus events, so a
// self-contained Dialog is the robust choice here.
// Selecting an emoji calls onSelect(emoji); the "remove" action calls
// onSelect(null) to clear it back to the default icon.
import { lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

// Loaded on first open: emoji-mart and its data are large and rarely used (#369).
const EmojiMartPicker = lazy(() => import("@/components/EmojiMartPicker"));

interface EmojiPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen emoji, or null to clear back to the default icon. */
  onSelect: (emoji: string | null) => void;
  /** Whether to show the "remove emoji" action (only when one is already set). */
  canRemove?: boolean;
}

export function EmojiPicker({
  open,
  onOpenChange,
  onSelect,
  canRemove,
}: EmojiPickerProps) {
  const { t } = useI18n();

  // Radix can leave `pointer-events: none` on <body> if the dialog unmounts while
  // another layer (the originating context menu) is still tearing down — that
  // freezes the whole window. Defensively clear it after every close.
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        if (document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "";
        }
      }, 0);
    }
  };

  // Close the dialog first, then apply the change on the next tick. Doing both
  // synchronously lets the parent's re-render (mutation → cache refresh) race the
  // dialog's unmount, which can leave `pointer-events: none` stuck on <body> and
  // freeze the whole window.
  const commit = (emoji: string | null) => {
    handleOpenChange(false);
    setTimeout(() => onSelect(emoji), 0);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-auto max-w-none flex-col overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 px-4 pb-2 pt-3">
          <DialogTitle className="text-sm">{t("emoji.set")}</DialogTitle>
        </DialogHeader>
        <Suspense fallback={null}>
          <EmojiMartPicker onSelect={commit} />
        </Suspense>
        {canRemove && (
          <div className="shrink-0 border-t border-muted/35 p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs text-muted hover:text-fg"
              onClick={() => commit(null)}
            >
              {t("emoji.remove")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
