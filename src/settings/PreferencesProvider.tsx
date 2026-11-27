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
import {
  DEFAULT_SPECTRUM_PATTERN,
  isSpectrumPattern,
  type SpectrumPattern,
} from "@/audio/spectrumPatterns";
import {
  DEFAULT_PET_SIZE,
  isPetSize,
  type PetSize,
} from "@/components/pet/petSize";
import { platform } from "@/lib/platform";

// public/theme-boot.js reads randomThemeOnStartup from this key before the bundle loads.
const LS_KEY = "meguri.prefs";

export const DEFAULT_SCENE_COUNT = 12;
export const SCENE_COUNT_MIN = 1;
export const SCENE_COUNT_MAX = 48;
// Choices offered in the settings UI.
export const SCENE_COUNT_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 32] as const;

// Frames per filmstrip row. A fixed count, not one fitted to the width: the
// frame times follow the count, so a width-fitted count would fetch every
// frame again on each resize (a side peek docking, say). The frames grow
// or shrink to fill the row instead.
export const DEFAULT_FILMSTRIP_FRAMES = 10;
export const FILMSTRIP_FRAMES_MIN = 4;
export const FILMSTRIP_FRAMES_MAX = 24;
// Choices offered in the settings UI.
export const FILMSTRIP_FRAMES_OPTIONS = [4, 6, 8, 10, 12, 16, 20, 24] as const;

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

// Thumbnail width in the list view; "small" is the dense option for working
// through many files at once.
export const LIST_THUMB_SIZE_OPTIONS = ["small", "medium", "large"] as const;
export type ListThumbSize = (typeof LIST_THUMB_SIZE_OPTIONS)[number];
export const DEFAULT_LIST_THUMB_SIZE: ListThumbSize = "medium";

// Which end of the title bar holds the window buttons (#578), or none, for a
// window manager that handles windows itself (a tiling one). The default
// follows the OS: macOS keeps its traffic lights on the left, Windows and
// Linux put theirs on the right.
export const WINDOW_BUTTONS_OPTIONS = ["left", "right", "none"] as const;
export type WindowButtons = (typeof WINDOW_BUTTONS_OPTIONS)[number];
export function defaultWindowButtons(): WindowButtons {
  return platform() === "darwin" ? "left" : "right";
}

export function isWindowButtons(v: unknown): v is WindowButtons {
  return WINDOW_BUTTONS_OPTIONS.includes(v as WindowButtons);
}

export function isListThumbSize(v: unknown): v is ListThumbSize {
  return LIST_THUMB_SIZE_OPTIONS.includes(v as ListThumbSize);
}

interface Prefs {
  randomThemeOnStartup: boolean;
  sceneCount: number;
  filmstripFrames: number;
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
  /** Whether an item change dips out and back (the opacity half of the switch). */
  playlistFade: boolean;
  /** Whether an item change slides sideways (the positional half of the switch). */
  playlistTransition: boolean;
  /**
   * Whether audio playback shows a live frequency spectrum on the detail
   * stage, the side peek and the playlist stage. The OS "reduce motion"
   * setting overrides this to off.
   */
  audioSpectrum: boolean;
  /** Which look the spectrum takes (see src/audio/spectrumPatterns.ts). */
  audioSpectrumPattern: SpectrumPattern;
  /** Thumbnail width in the list view. */
  listThumbSize: ListThumbSize;
  /**
   * Whether a video or track opens where it was last stopped. Off, everything
   * starts from zero; positions are still recorded, so the progress bars and
   * the "In progress" filter keep working.
   */
  resumePlayback: boolean;
  /** Whether the zabuton pet is out in the window ("Put away" turns it off). */
  petVisible: boolean;
  /** How large the pet is drawn (see src/components/pet/petSize.ts). */
  petSize: PetSize;
  /** Which end of the title bar holds the window buttons. */
  windowButtons: WindowButtons;
}

const DEFAULTS: Prefs = {
  randomThemeOnStartup: false,
  sceneCount: DEFAULT_SCENE_COUNT,
  filmstripFrames: DEFAULT_FILMSTRIP_FRAMES,
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
  audioSpectrum: true,
  audioSpectrumPattern: DEFAULT_SPECTRUM_PATTERN,
  listThumbSize: DEFAULT_LIST_THUMB_SIZE,
  resumePlayback: true,
  petVisible: true,
  petSize: DEFAULT_PET_SIZE,
  windowButtons: defaultWindowButtons(),
};

function clampSceneCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCENE_COUNT;
  return Math.min(SCENE_COUNT_MAX, Math.max(SCENE_COUNT_MIN, Math.round(n)));
}

// Anything but a number (an "auto" stored by an earlier build, too) reads as
// the default.
function parseFilmstripFrames(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    return DEFAULT_FILMSTRIP_FRAMES;
  return Math.min(
    FILMSTRIP_FRAMES_MAX,
    Math.max(FILMSTRIP_FRAMES_MIN, Math.round(v)),
  );
}

export function clampPlaylistImageSeconds(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PLAYLIST_IMAGE_SECONDS;
  return Math.min(
    PLAYLIST_IMAGE_SECONDS_MAX,
    Math.max(PLAYLIST_IMAGE_SECONDS_MIN, Math.round(n)),
  );
}

/** Load saved prefs, falling back to defaults for missing/invalid fields. */
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      return {
        randomThemeOnStartup:
          typeof parsed.randomThemeOnStartup === "boolean"
            ? parsed.randomThemeOnStartup
            : DEFAULTS.randomThemeOnStartup,
        sceneCount:
          typeof parsed.sceneCount === "number"
            ? clampSceneCount(parsed.sceneCount)
            : DEFAULT_SCENE_COUNT,
        filmstripFrames: parseFilmstripFrames(parsed.filmstripFrames),
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
        audioSpectrum:
          typeof parsed.audioSpectrum === "boolean"
            ? parsed.audioSpectrum
            : DEFAULTS.audioSpectrum,
        audioSpectrumPattern: isSpectrumPattern(parsed.audioSpectrumPattern)
          ? parsed.audioSpectrumPattern
          : DEFAULTS.audioSpectrumPattern,
        listThumbSize: isListThumbSize(parsed.listThumbSize)
          ? parsed.listThumbSize
          : DEFAULT_LIST_THUMB_SIZE,
        resumePlayback:
          typeof parsed.resumePlayback === "boolean"
            ? parsed.resumePlayback
            : DEFAULTS.resumePlayback,
        petVisible:
          typeof parsed.petVisible === "boolean"
            ? parsed.petVisible
            : DEFAULTS.petVisible,
        petSize: isPetSize(parsed.petSize) ? parsed.petSize : DEFAULT_PET_SIZE,
        windowButtons: isWindowButtons(parsed.windowButtons)
          ? parsed.windowButtons
          : DEFAULTS.windowButtons,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULTS;
}

interface PrefsCtx extends Prefs {
  setRandomThemeOnStartup: (enabled: boolean) => void;
  setSceneCount: (n: number) => void;
  setFilmstripFrames: (n: number) => void;
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
  setAudioSpectrum: (enabled: boolean) => void;
  setAudioSpectrumPattern: (p: SpectrumPattern) => void;
  setListThumbSize: (s: ListThumbSize) => void;
  setResumePlayback: (enabled: boolean) => void;
  setPetVisible: (visible: boolean) => void;
  setPetSize: (size: PetSize) => void;
  setWindowButtons: (side: WindowButtons) => void;
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
      setRandomThemeOnStartup: (enabled) =>
        setPrefs((p) => ({ ...p, randomThemeOnStartup: enabled })),
      setSceneCount: (n) =>
        setPrefs((p) => ({ ...p, sceneCount: clampSceneCount(n) })),
      setFilmstripFrames: (v) =>
        setPrefs((p) => ({ ...p, filmstripFrames: parseFilmstripFrames(v) })),
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
      setAudioSpectrum: (enabled) =>
        setPrefs((p) => ({ ...p, audioSpectrum: enabled })),
      setAudioSpectrumPattern: (pattern) =>
        setPrefs((p) => ({ ...p, audioSpectrumPattern: pattern })),
      setListThumbSize: (size) =>
        setPrefs((p) => ({ ...p, listThumbSize: size })),
      setResumePlayback: (enabled) =>
        setPrefs((p) => ({ ...p, resumePlayback: enabled })),
      setPetVisible: (visible) =>
        setPrefs((p) => ({ ...p, petVisible: visible })),
      setPetSize: (size) => setPrefs((p) => ({ ...p, petSize: size })),
      setWindowButtons: (side) =>
        setPrefs((p) => ({ ...p, windowButtons: side })),
    }),
    [prefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The preferences, or null outside PreferencesProvider. For the few consumers
 * mounted where the provider may be absent (the audio provider sits above the
 * router and is rendered on its own in tests).
 */
export function useOptionalPreferences(): PrefsCtx | null {
  return useContext(Ctx);
}

export function usePreferences(): PrefsCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
