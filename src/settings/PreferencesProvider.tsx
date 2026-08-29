// User preferences (non-theme/non-language) persisted to localStorage, same approach as
// ThemeProvider / I18nProvider. Currently holds the scene-thumbnail count; add new prefs here.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_KEYBINDING_PRESET,
  isKeybindingPreset,
  type KeybindingPreset,
} from "@/settings/keybindings";

const LS_KEY = "meguri.prefs";

export const DEFAULT_SCENE_COUNT = 12;
export const SCENE_COUNT_MIN = 1;
export const SCENE_COUNT_MAX = 48;
// Choices offered in the settings UI.
export const SCENE_COUNT_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 32] as const;

// Frame-preview (hover scrub / scene rail) quality presets, mirrored by the
// media server's ?q= allowlist in electron/core/server.ts.
export const FRAME_QUALITY_OPTIONS = ["low", "standard", "high"] as const;
export type FrameQuality = (typeof FRAME_QUALITY_OPTIONS)[number];
export const DEFAULT_FRAME_QUALITY: FrameQuality = "low";

export function isFrameQuality(v: unknown): v is FrameQuality {
  return FRAME_QUALITY_OPTIONS.includes(v as FrameQuality);
}

// Emoji glyph styles. Each id is stable API shared by localStorage, the
// <html data-emoji-style> attribute, and the --font-emoji mapping in
// src/styles/emoji-fonts.css — renaming one would orphan stored prefs.
export const EMOJI_STYLE_OPTIONS = [
  "native", // OS emoji font (default; no bundled font involved)
  "twemoji", // flat full-color (Twemoji Mozilla, COLRv0)
  "noto", // monochrome (Noto Emoji)
  "openmoji", // outline color (OpenMoji glyf_colr_0)
] as const;
export type EmojiStyle = (typeof EMOJI_STYLE_OPTIONS)[number];
export const DEFAULT_EMOJI_STYLE: EmojiStyle = "native";

export function isEmojiStyle(v: unknown): v is EmojiStyle {
  return EMOJI_STYLE_OPTIONS.includes(v as EmojiStyle);
}

// Playlist playback: how long a still image stays on screen before the player
// advances. The pan/zoom animation runs for exactly this long, so a value that
// drifts from the timer would leave the image frozen before it advances.
export const DEFAULT_PLAYLIST_IMAGE_SECONDS = 5;
export const PLAYLIST_IMAGE_SECONDS_MIN = 1;
export const PLAYLIST_IMAGE_SECONDS_MAX = 60;
// Choices offered in the settings UI.
export const PLAYLIST_IMAGE_SECONDS_OPTIONS = [
  3, 5, 8, 10, 15, 20, 30,
] as const;

interface Prefs {
  sceneCount: number;
  keybindingPreset: KeybindingPreset;
  hideSupportLink: boolean;
  hoverPreview: boolean;
  frameQuality: FrameQuality;
  emojiStyle: EmojiStyle;
  /** Seconds a still image is shown in the playlist player before advancing. */
  playlistImageSeconds: number;
  /** Whether playlist playback starts shuffled (carried over between sessions). */
  playlistShuffle: boolean;
  /** Whether playlist playback loops back to the start after one pass. */
  playlistRepeat: boolean;
  /**
   * Whether images get the pan/zoom motion. The OS "reduce motion" setting
   * overrides this to off; this flag only lets the user turn it off as well.
   */
  playlistImageMotion: boolean;
  /** Whether an item change dips through black (the opacity half of the switch). */
  playlistFade: boolean;
  /** Whether an item change slides sideways (the positional half of the switch). */
  playlistTransition: boolean;
}

const DEFAULTS: Prefs = {
  sceneCount: DEFAULT_SCENE_COUNT,
  keybindingPreset: DEFAULT_KEYBINDING_PRESET,
  hideSupportLink: false,
  hoverPreview: true,
  frameQuality: DEFAULT_FRAME_QUALITY,
  emojiStyle: DEFAULT_EMOJI_STYLE,
  playlistImageSeconds: DEFAULT_PLAYLIST_IMAGE_SECONDS,
  playlistShuffle: false,
  playlistRepeat: false,
  playlistImageMotion: true,
  playlistFade: true,
  playlistTransition: false,
};

function clampSceneCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCENE_COUNT;
  return Math.min(SCENE_COUNT_MAX, Math.max(SCENE_COUNT_MIN, Math.round(n)));
}

export function clampPlaylistImageSeconds(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PLAYLIST_IMAGE_SECONDS;
  return Math.min(
    PLAYLIST_IMAGE_SECONDS_MAX,
    Math.max(PLAYLIST_IMAGE_SECONDS_MIN, Math.round(n)),
  );
}

/** Load saved prefs, falling back to defaults for missing/invalid fields. */
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      return {
        sceneCount:
          typeof parsed.sceneCount === "number"
            ? clampSceneCount(parsed.sceneCount)
            : DEFAULT_SCENE_COUNT,
        keybindingPreset: isKeybindingPreset(parsed.keybindingPreset)
          ? parsed.keybindingPreset
          : DEFAULT_KEYBINDING_PRESET,
        hideSupportLink:
          typeof parsed.hideSupportLink === "boolean"
            ? parsed.hideSupportLink
            : DEFAULTS.hideSupportLink,
        hoverPreview:
          typeof parsed.hoverPreview === "boolean"
            ? parsed.hoverPreview
            : DEFAULTS.hoverPreview,
        frameQuality: isFrameQuality(parsed.frameQuality)
          ? parsed.frameQuality
          : DEFAULT_FRAME_QUALITY,
        emojiStyle: isEmojiStyle(parsed.emojiStyle)
          ? parsed.emojiStyle
          : DEFAULT_EMOJI_STYLE,
        playlistImageSeconds:
          typeof parsed.playlistImageSeconds === "number"
            ? clampPlaylistImageSeconds(parsed.playlistImageSeconds)
            : DEFAULT_PLAYLIST_IMAGE_SECONDS,
        playlistShuffle:
          typeof parsed.playlistShuffle === "boolean"
            ? parsed.playlistShuffle
            : DEFAULTS.playlistShuffle,
        playlistRepeat:
          typeof parsed.playlistRepeat === "boolean"
            ? parsed.playlistRepeat
            : DEFAULTS.playlistRepeat,
        playlistImageMotion:
          typeof parsed.playlistImageMotion === "boolean"
            ? parsed.playlistImageMotion
            : DEFAULTS.playlistImageMotion,
        playlistFade:
          typeof parsed.playlistFade === "boolean"
            ? parsed.playlistFade
            : DEFAULTS.playlistFade,
        playlistTransition:
          typeof parsed.playlistTransition === "boolean"
            ? parsed.playlistTransition
            : DEFAULTS.playlistTransition,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULTS;
}

interface PrefsCtx extends Prefs {
  setSceneCount: (n: number) => void;
  setKeybindingPreset: (p: KeybindingPreset) => void;
  setHideSupportLink: (hidden: boolean) => void;
  setHoverPreview: (enabled: boolean) => void;
  setFrameQuality: (q: FrameQuality) => void;
  setEmojiStyle: (s: EmojiStyle) => void;
  setPlaylistImageSeconds: (n: number) => void;
  setPlaylistShuffle: (enabled: boolean) => void;
  setPlaylistRepeat: (enabled: boolean) => void;
  setPlaylistImageMotion: (enabled: boolean) => void;
  setPlaylistFade: (enabled: boolean) => void;
  setPlaylistTransition: (enabled: boolean) => void;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  // Mirror the emoji style to <html data-emoji-style>, which
  // src/styles/emoji-fonts.css maps to the --font-emoji font family. Emoji only
  // appear in React-rendered content, so applying it at mount is early enough
  // (no pre-paint boot script needed, unlike data-theme).
  useEffect(() => {
    document.documentElement.dataset.emojiStyle = prefs.emojiStyle;
  }, [prefs.emojiStyle]);

  const value = useMemo<PrefsCtx>(
    () => ({
      ...prefs,
      setSceneCount: (n) =>
        setPrefs((p) => ({ ...p, sceneCount: clampSceneCount(n) })),
      setKeybindingPreset: (kp) =>
        setPrefs((p) => ({ ...p, keybindingPreset: kp })),
      setHideSupportLink: (hidden) =>
        setPrefs((p) => ({ ...p, hideSupportLink: hidden })),
      setHoverPreview: (enabled) =>
        setPrefs((p) => ({ ...p, hoverPreview: enabled })),
      setFrameQuality: (q) => setPrefs((p) => ({ ...p, frameQuality: q })),
      setEmojiStyle: (s) => setPrefs((p) => ({ ...p, emojiStyle: s })),
      setPlaylistImageSeconds: (n) =>
        setPrefs((p) => ({
          ...p,
          playlistImageSeconds: clampPlaylistImageSeconds(n),
        })),
      setPlaylistShuffle: (enabled) =>
        setPrefs((p) => ({ ...p, playlistShuffle: enabled })),
      setPlaylistRepeat: (enabled) =>
        setPrefs((p) => ({ ...p, playlistRepeat: enabled })),
      setPlaylistImageMotion: (enabled) =>
        setPrefs((p) => ({ ...p, playlistImageMotion: enabled })),
      setPlaylistFade: (enabled) =>
        setPrefs((p) => ({ ...p, playlistFade: enabled })),
      setPlaylistTransition: (enabled) =>
        setPrefs((p) => ({ ...p, playlistTransition: enabled })),
    }),
    [prefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PrefsCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
