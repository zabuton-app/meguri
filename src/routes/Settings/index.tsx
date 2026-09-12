// Settings screen, split into tabs by category. Like MediaDetail, it floats
// (as a modal) over the list.
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Coffee, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/ipc/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/themes/ThemeProvider";
import { deriveTokens, type Token } from "@/themes/derive";
import { LANGUAGES, useI18n, type Lang } from "@/i18n/I18nProvider";
import { type TranslationKey } from "@/i18n/locales/ja";
import {
  usePreferences,
  SCENE_COUNT_OPTIONS,
  PLAYLIST_IMAGE_SECONDS_OPTIONS,
  FRAME_QUALITY_OPTIONS,
  isFrameQuality,
  type FrameQuality,
  EMOJI_STYLE_OPTIONS,
  isEmojiStyle,
  type EmojiStyle,
} from "@/settings/PreferencesProvider";
import {
  KEYBINDING_PRESETS,
  type KeybindingPreset,
} from "@/settings/keybindings";
import { LOGO_IDS, type LogoId } from "@shared/ipc/schema";
import { LOGO_SRC, useLogo } from "@/hooks/useLogo";
import { SettingsModal, SETTINGS_MODAL_TITLE_ID } from "./SettingsModal";
import { UpdateSection } from "./UpdateSection";
import { AboutSection } from "./AboutSection";

const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/amgsk";

// Swatches for the theme picker. Derived tokens, not raw palette slots, so what the swatch
// shows is what the UI will actually use — and the chrome colors that used to be invisible in
// some themes (hairlines, secondary text) can be judged before switching.
const PREVIEW_TOKENS: Token[] = [
  "bg",
  "border",
  "muted",
  "primary",
  "accent2",
  "error",
];

const FRAME_QUALITY_LABELS: Record<FrameQuality, TranslationKey> = {
  low: "settings.frameQualityLow",
  standard: "settings.frameQualityStandard",
  high: "settings.frameQualityHigh",
};

const EMOJI_STYLE_LABELS: Record<EmojiStyle, TranslationKey> = {
  native: "settings.emojiStyleNative",
  twemoji: "settings.emojiStyleTwemoji",
  noto: "settings.emojiStyleNoto",
  openmoji: "settings.emojiStyleOpenmoji",
};

// Per-option font for the sample string, so styles can be compared before
// choosing. "native" uses the same non-existent-family trick as emoji-fonts.css
// to reach the OS emoji font even while another style is active.
const EMOJI_STYLE_FONTS: Record<EmojiStyle, string> = {
  native: '"meguri-emoji-none"',
  twemoji: '"Meguri Twemoji"',
  noto: '"Meguri Noto Emoji"',
  openmoji: '"Meguri OpenMoji"',
};

const EMOJI_SAMPLE = "😀🎬📁";

const LOGO_LABELS: Record<LogoId, TranslationKey> = {
  dark: "logo.dark",
  light: "logo.light",
  enso: "logo.enso",
};

/** Tab ids. The tab bar's order comes from the `tabs` array below. */
type TabId = "general" | "library" | "playback" | "app";

export default function Settings() {
  const { mode, familyId, families, setMode, setFamily } = useTheme();
  const { lang, setLang, t } = useI18n();
  const tabs = useMemo<readonly SettingsTab<TabId>[]>(
    () => [
      { id: "general", label: t("settings.tabGeneral") },
      { id: "library", label: t("settings.tabLibrary") },
      { id: "playback", label: t("settings.tabPlayback") },
      { id: "app", label: t("settings.tabApp") },
    ],
    [t],
  );
  const {
    sceneCount,
    setSceneCount,
    keybindingPreset,
    setKeybindingPreset,
    hideSupportLink,
    setHideSupportLink,
    hoverPreview,
    setHoverPreview,
    frameQuality,
    playlistImageSeconds,
    setPlaylistImageSeconds,
    playlistImageMotion,
    setPlaylistImageMotion,
    playlistFade,
    setPlaylistFade,
    playlistTransition,
    setPlaylistTransition,
    playlistShuffle,
    setPlaylistShuffle,
    setFrameQuality,
    emojiStyle,
    setEmojiStyle,
  } = usePreferences();
  const navigate = useNavigate();
  // Not persisted: opening settings should always land on the first tab rather
  // than wherever the previous visit happened to stop.
  const [tab, setTab] = useState<TabId>("general");
  // Closing the modal = drop the child route and return to the list (the list stays mounted).
  const onClose = useCallback(() => navigate("/"), [navigate]);

  const { logo, setLogo: selectLogo } = useLogo();

  return (
    <SettingsModal onClose={() => void onClose()}>
      <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2.5">
        <span
          id={SETTINGS_MODAL_TITLE_ID}
          className="text-sm font-semibold text-bright-fg"
        >
          {t("settings.title")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2"
          onClick={() => void onClose()}
          title={`${t("common.close")} (Esc)`}
        >
          <X />
        </Button>
      </header>

      <SettingsTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        label={t("settings.title")}
      />

      <ScrollArea className="min-h-0 flex-1" viewportClassName="p-4 pb-6">
        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          className="mx-auto flex max-w-2xl flex-col gap-3"
        >
          {tab === "general" && (
            <>
              {/* Language switch */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.language")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.languageDesc")}
                  </span>
                </div>
                <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
                  <SelectTrigger className="min-w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* Keybinding preset (file paging keys) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.keybinding")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.keybindingDesc")}
                  </span>
                </div>
                <Select
                  value={keybindingPreset}
                  onValueChange={(v) =>
                    setKeybindingPreset(v as KeybindingPreset)
                  }
                >
                  <SelectTrigger className="min-w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KEYBINDING_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`keybinding.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* Appearance switch */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.appearance")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.appearanceDesc")}
                  </span>
                </div>
                <div className="flex overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => setMode("light")}
                    className={
                      "flex items-center gap-1.5 px-3 py-1.5 text-sm transition " +
                      (mode === "light"
                        ? "bg-primary text-primary-foreground"
                        : "bg-bg text-muted hover:text-fg")
                    }
                  >
                    <Sun className="size-4" />
                    {t("settings.light")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("dark")}
                    className={
                      "flex items-center gap-1.5 px-3 py-1.5 text-sm transition " +
                      (mode === "dark"
                        ? "bg-primary text-primary-foreground"
                        : "bg-bg text-muted hover:text-fg")
                    }
                  >
                    <Moon className="size-4" />
                    {t("settings.dark")}
                  </button>
                </div>
              </section>

              {/* Theme (family) selection */}
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-bright-fg">
                  {t("settings.theme")}
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {families.map((fam) => {
                    // Preview the variant for the current appearance (or the paired variant if absent).
                    const variant = fam[mode] ?? fam.dark ?? fam.light;
                    if (!variant) return null;
                    const active = fam.id === familyId;
                    const swatch = deriveTokens(variant);
                    return (
                      <button
                        key={fam.id}
                        type="button"
                        onClick={() => setFamily(fam.id)}
                        className={
                          "flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2 text-left transition " +
                          (active
                            ? "border-primary ring-1 ring-primary"
                            : "border-border hover:border-primary")
                        }
                      >
                        <span className="flex items-center gap-2">
                          <span className="flex overflow-hidden rounded-[3px] border border-border">
                            {PREVIEW_TOKENS.map((token) => (
                              <span
                                key={token}
                                className="h-4 w-4"
                                style={{ backgroundColor: swatch[token] }}
                              />
                            ))}
                          </span>
                          <span className="text-sm text-fg">{fam.name}</span>
                        </span>
                        {active && <Check className="size-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Emoji glyph style (applies to all emoji in the UI) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.emojiStyle")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.emojiStyleDesc")}
                  </span>
                </div>
                <Select
                  value={emojiStyle}
                  onValueChange={(v) => {
                    if (isEmojiStyle(v)) setEmojiStyle(v);
                  }}
                >
                  <SelectTrigger className="min-w-44">
                    {/* Custom children: the trigger shows only the label — the
                        emoji sample would wrap it onto two lines. The per-style
                        samples stay in the dropdown items below. */}
                    <SelectValue>
                      {t(EMOJI_STYLE_LABELS[emojiStyle])}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EMOJI_STYLE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {t(EMOJI_STYLE_LABELS[s])}
                          <span
                            aria-hidden="true"
                            style={{ fontFamily: EMOJI_STYLE_FONTS[s] }}
                          >
                            {EMOJI_SAMPLE}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* App logo (window, tray, and in-app icon) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.logo")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.logoDesc")}
                  </span>
                </div>
                <div className="flex gap-2">
                  {LOGO_IDS.map((id) => {
                    const active = logo === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => selectLogo(id)}
                        className={
                          "flex flex-col items-center gap-1.5 rounded-md border px-3 py-2 transition " +
                          (active
                            ? "border-primary ring-1 ring-primary"
                            : "border-border hover:border-primary")
                        }
                      >
                        <img
                          src={LOGO_SRC[id]}
                          alt=""
                          className="size-12 rounded-md"
                          draggable={false}
                        />
                        <span
                          className={
                            "text-xs " + (active ? "text-fg" : "text-muted")
                          }
                        >
                          {t(LOGO_LABELS[id])}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {tab === "library" && (
            <>
              {/* Scene thumbnail count */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.scenes")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.scenesDesc")}
                  </span>
                </div>
                <Select
                  value={String(sceneCount)}
                  onValueChange={(v) => setSceneCount(Number(v))}
                >
                  <SelectTrigger className="min-w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCENE_COUNT_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* Hover preview (scrub preview on video thumbnails) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.hoverPreview")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.hoverPreviewDesc")}
                  </span>
                </div>
                <Switch
                  checked={hoverPreview}
                  onCheckedChange={setHoverPreview}
                />
              </section>

              {/* Frame preview quality (hover scrub / scene rail JPEG size) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.frameQuality")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.frameQualityDesc")}
                  </span>
                </div>
                <Select
                  value={frameQuality}
                  onValueChange={(v) => {
                    if (isFrameQuality(v)) setFrameQuality(v);
                  }}
                >
                  <SelectTrigger className="min-w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FRAME_QUALITY_OPTIONS.map((q) => (
                      <SelectItem key={q} value={q}>
                        {t(FRAME_QUALITY_LABELS[q])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
            </>
          )}

          {tab === "playback" && (
            <>
              {/* Playlist: image duration (also the pan/zoom duration) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.playlistImageSeconds")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.playlistImageSecondsHint")}
                  </span>
                </div>
                <Select
                  value={String(playlistImageSeconds)}
                  onValueChange={(v) => setPlaylistImageSeconds(Number(v))}
                >
                  <SelectTrigger className="min-w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAYLIST_IMAGE_SECONDS_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t("settings.secondsValue", { n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* Playlist: image pan/zoom (the OS reduce-motion setting still wins) */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.playlistImageMotion")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.playlistImageMotionHint")}
                  </span>
                </div>
                <Switch
                  checked={playlistImageMotion}
                  onCheckedChange={setPlaylistImageMotion}
                />
              </section>

              {/* Playlist: switching effects. The two are independent — fade dims,
                  transition slides — and the OS reduce-motion setting overrides both. */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.playlistFade")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.playlistFadeHint")}
                  </span>
                </div>
                <Switch
                  checked={playlistFade}
                  onCheckedChange={setPlaylistFade}
                />
              </section>

              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.playlistTransition")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.playlistTransitionHint")}
                  </span>
                </div>
                <Switch
                  checked={playlistTransition}
                  onCheckedChange={setPlaylistTransition}
                />
              </section>

              {/* Playlist: playback order. Also toggled from the player itself. */}
              <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-bright-fg">
                    {t("settings.playlistShuffle")}
                  </span>
                  <span className="text-xs text-muted">
                    {t("settings.playlistShuffleHint")}
                  </span>
                </div>
                <Switch
                  checked={playlistShuffle}
                  onCheckedChange={setPlaylistShuffle}
                />
              </section>
            </>
          )}

          {tab === "app" && (
            <>
              {/* Update check */}
              <UpdateSection />

              {/* Support / donation link (dismissible; hidden permanently once closed) */}
              {!hideSupportLink && (
                <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-bright-fg">
                      {t("settings.support")}
                    </span>
                    <span className="text-xs text-muted">
                      {t("settings.supportDesc")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void api.openUrl(BUY_ME_A_COFFEE_URL)}
                    >
                      <Coffee className="size-4" />
                      {t("settings.buyMeCoffee")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setHideSupportLink(true)}
                      aria-label={t("settings.hideSupport")}
                      title={t("settings.hideSupport")}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </section>
              )}

              {/* About / license attributions */}
              <AboutSection />
            </>
          )}
        </div>
      </ScrollArea>
    </SettingsModal>
  );
}
