// The emoji-mart picker itself, split out of EmojiPicker.tsx so emoji-mart and
// its data (about 480 kB) load only when the dialog first opens (#369).
import { useCallback, useMemo } from "react";
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
import { useTheme } from "@/themes/ThemeProvider";
import { useI18n, type Lang } from "@/i18n/I18nProvider";

// emoji-mart writes `font-family` as an INLINE style on the span that carries
// each native glyph, so neither inheritance nor a document-level rule on the
// em-emoji-picker host can restyle the grid. Overriding from inside the shadow
// root with !important is the only offline, dependency-free way to make the
// picker follow the selected emoji style. var(--font-family) resolves to the
// emoji-augmented UI stack that emoji-fonts.css sets on the host element
// (custom properties inherit across the shadow boundary).
const SHADOW_STYLE_ID = "meguri-emoji-style";
// The grid's scrollbar is drawn by emoji-mart in its own palette, out of reach
// of the document-level ::-webkit-scrollbar rules in styles.css. Restyle its
// thumb to match ScrollArea's (the theme's --c-* variables also inherit across
// the shadow boundary). The bar keeps emoji-mart's width: the picker reserves
// --sidebar-width for it when sizing the grid, so the wider transparent border
// narrows the visible thumb instead. The rules carry emoji-mart's own `.scroll`
// selectors and !important: its hover colour is !important too, and this style
// is appended after emoji-mart's, so at equal specificity it wins.
const SHADOW_CSS = `.emoji-mart-emoji span {
  font-family: var(--font-family) !important;
}
.scroll::-webkit-scrollbar-track,
.scroll::-webkit-scrollbar-corner {
  background: transparent !important;
}
.scroll::-webkit-scrollbar-thumb {
  min-height: 24px !important;
  border: 5px solid transparent !important;
  border-radius: 9999px !important;
  background-color: var(--c-overlay) !important;
  background-clip: padding-box !important;
}
.scroll::-webkit-scrollbar-thumb:hover {
  background-color: var(--c-muted) !important;
}`;

/** Inject the font and scrollbar overrides into the picker's shadow root (idempotent). */
function injectShadowCss(host: Element): boolean {
  const root = host.shadowRoot;
  if (!root) return false;
  if (!root.getElementById(SHADOW_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = SHADOW_STYLE_ID;
    style.textContent = SHADOW_CSS;
    root.appendChild(style);
  }
  return true;
}

// Map our app languages to the bundled emoji-mart i18n packs (falls back to en).
const EMOJI_MART_I18N: Record<Lang, unknown> = {
  ja: i18nJa,
  en: i18nEn,
  "zh-CN": i18nZh,
  ko: i18nKo,
  es: i18nEs,
  fr: i18nFr,
};

export default function EmojiMartPicker({
  onSelect,
}: {
  onSelect: (emoji: string | null) => void;
}) {
  const { mode } = useTheme();
  const { lang } = useI18n();
  const emojiI18n = useMemo(() => EMOJI_MART_I18N[lang] ?? i18nEn, [lang]);

  // emoji-mart creates the em-emoji-picker element (and its shadow root)
  // asynchronously after mount, so poll a few frames until it appears.
  const pickerHostRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    let tries = 0;
    let raf = 0;
    const tryInject = () => {
      const host = node.querySelector("em-emoji-picker");
      if ((host && injectShadowCss(host)) || tries++ > 60) return;
      raf = requestAnimationFrame(tryInject);
    };
    tryInject();

    // Radix's scroll lock (react-remove-scroll) listens for `wheel` on
    // `document` and preventDefault()s it unless the event target's ancestor
    // chain contains a scrollable element. A wheel over the picker originates
    // inside emoji-mart's shadow root, so by the time it reaches `document` it
    // has been retargeted to the <em-emoji-picker> host — whose light-DOM
    // ancestors do not scroll. The lock therefore cancels every wheel and the
    // emoji grid can only be scrolled by dragging its scrollbar. Stop the event
    // below `document` so the lock never sees it; the shadow root's own
    // scroller still handles it natively.
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    node.addEventListener("wheel", stopWheel);

    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener("wheel", stopWheel);
    };
  }, []);

  // emoji-mart's picker has a fixed intrinsic height; on short viewports it
  // overflows the centered dialog. Wrap it in a scrollable region so the
  // full grid stays reachable.
  return (
    <div ref={pickerHostRef} className="min-h-0 flex-1 overflow-y-auto">
      <Picker
        data={data}
        i18n={emojiI18n}
        theme={mode}
        previewPosition="none"
        skinTonePosition="none"
        onEmojiSelect={(emoji: { native?: string }) =>
          onSelect(emoji.native ?? null)
        }
      />
    </div>
  );
}
