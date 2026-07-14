// Emoji picker dialog built on emoji-mart, themed/localized to match the app.
// Used to set the icon of a workspace or collection. It is a modal dialog (not a
// popover) opened from a context menu — a popover anchored to the trigger gets
// dismissed instantly by the closing context menu's pointer/focus events, so a
// self-contained Dialog is the robust choice here.
// Selecting an emoji calls onSelect(emoji); the "remove" action calls
// onSelect(null) to clear it back to the default icon.
import { useMemo } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
// Bundle the locale packs locally. emoji-mart otherwise fetches them from a CDN
// (cdn.jsdelivr.net), which both violates our CSP and breaks the app's offline /
// no-runtime-dependency design. Passing `i18n` explicitly avoids that fetch.
import i18nJa from "@emoji-mart/data/i18n/ja.json";
import i18nEn from "@emoji-mart/data/i18n/en.json";
import i18nZh from "@emoji-mart/data/i18n/zh.json";
import i18nKo from "@emoji-mart/data/i18n/ko.json";
import i18nEs from "@emoji-mart/data/i18n/es.json";
import i18nFr from "@emoji-mart/data/i18n/fr.json";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/themes/ThemeProvider";
import { useI18n, type Lang } from "@/i18n/I18nProvider";

// Map our app languages to the bundled emoji-mart i18n packs (falls back to en).
const EMOJI_MART_I18N: Record<Lang, unknown> = {
  ja: i18nJa,
  en: i18nEn,
  "zh-CN": i18nZh,
  ko: i18nKo,
  es: i18nEs,
  fr: i18nFr,
};

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
  const { mode } = useTheme();
  const { lang, t } = useI18n();
  const emojiI18n = useMemo(() => EMOJI_MART_I18N[lang] ?? i18nEn, [lang]);

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
        {/* emoji-mart's picker has a fixed intrinsic height; on short viewports it
            overflows the centered dialog. Wrap it in a scrollable region so the
            full grid stays reachable. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Picker
            data={data}
            i18n={emojiI18n}
            theme={mode}
            previewPosition="none"
            skinTonePosition="none"
            onEmojiSelect={(emoji: { native?: string }) =>
              commit(emoji.native ?? null)
            }
          />
        </div>
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
