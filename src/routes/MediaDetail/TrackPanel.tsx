// The control bar's audio and subtitles button and the panel it opens: one
// column per kind of track the clip offers to choose between.
import { useId, useState, type ReactNode } from "react";
import { Captions, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import { AUTO_SUBTITLE, SUBTITLES_OFF } from "@/lib/subtitlePreference";
import { languageName, trackLabel } from "@/lib/trackLabels";
import { CTRL_BUTTON_CLASS } from "./controlBar";
import { isTextSubtitle, type EmbeddedTrack } from "@shared/embeddedSubtitles";
import { DEFAULT_AUDIO_TRACK } from "@shared/playbackTracks";

export type SubtitleStatus = "idle" | "loading" | "error";

interface Props {
  /** Present when the clip has more than one audio track to choose from. */
  audio?: {
    tracks: Pick<EmbeddedTrack, "title" | "language">[];
    value: number;
    disabled: boolean;
    onChange: (index: number) => void;
  };
  /** Present when the clip has a text subtitle track. */
  subtitles?: {
    tracks: EmbeddedTrack[];
    /** The saved choice: a track index, AUTO_SUBTITLE or SUBTITLES_OFF. */
    value: number;
    onChange: (choice: number) => void;
    /** Language of the audio playing, which Match audio language follows. */
    audioLanguage: string;
    /** The track Match audio language resolves to, or -1. */
    autoTrack: number;
    /** Subtitles are on screen (the button is underlined). */
    shown: boolean;
    status: SubtitleStatus;
  };
  /** The element to render the panel in: the one that goes fullscreen. */
  portalTarget: () => HTMLElement | null;
  t: TFunc;
}

export function TrackPanel({ audio, subtitles, portalTarget, t }: Props) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const audioName = useId();
  const subtitleName = useId();
  const status = subtitles?.status ?? "idle";
  const title = t("player.audioSubtitles");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setContainer(portalTarget());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className={`relative ${CTRL_BUTTON_CLASS} data-[state=open]:bg-white/20 data-[state=open]:text-white`}
          // The player's shortcuts take Space on a focused button as play or
          // pause; here it has to open the panel.
          onKeyDown={(event) => {
            if (event.code === "Space") event.stopPropagation();
          }}
        >
          <Captions size={18} />
          {subtitles?.shown && (
            <span
              aria-hidden="true"
              className="absolute inset-x-2 bottom-0.5 h-0.5 rounded-full bg-primary"
            />
          )}
          {status === "loading" && (
            <span
              aria-hidden="true"
              className="absolute right-0 top-0 size-2.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
            />
          )}
          {status === "error" && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 size-2 rounded-full bg-warn"
            />
          )}
        </button>
      </PopoverTrigger>
      {status !== "idle" && (
        <span role="status" className="sr-only">
          {t(
            status === "error"
              ? "player.subtitleUnavailable"
              : "player.subtitleLoading",
          )}
        </span>
      )}
      <PopoverContent
        container={container}
        side="top"
        align="end"
        aria-label={title}
        className={`grid max-h-(--radix-popover-content-available-height) w-auto gap-1.5 overflow-y-auto border-white/15 bg-black/90 p-1.5 text-white ${
          audio && subtitles ? "grid-cols-2" : "grid-cols-1"
        }`}
      >
        {audio && (
          <Column legend={t("player.audioTrack")} divided={!!subtitles}>
            <Option
              name={audioName}
              checked={audio.value === DEFAULT_AUDIO_TRACK}
              disabled={audio.disabled}
              onSelect={() => audio.onChange(DEFAULT_AUDIO_TRACK)}
              label={t("player.audioTrackDefault")}
            />
            {audio.tracks.map((track, index) => (
              <Option
                key={index}
                name={audioName}
                checked={audio.value === index}
                disabled={audio.disabled}
                onSelect={() => audio.onChange(index)}
                {...trackLabel(
                  track,
                  t("player.audioTrackNumber", { number: index + 1 }),
                  lang,
                )}
              />
            ))}
          </Column>
        )}
        {subtitles && (
          <Column legend={t("player.subtitles")}>
            <Option
              name={subtitleName}
              checked={selectedSubtitle(subtitles) === SUBTITLES_OFF}
              onSelect={() => subtitles.onChange(SUBTITLES_OFF)}
              label={t("player.subtitleOff")}
            />
            <Option
              name={subtitleName}
              checked={subtitles.value === AUTO_SUBTITLE}
              onSelect={() => subtitles.onChange(AUTO_SUBTITLE)}
              label={t("player.subtitleAuto")}
              detail={autoDetail(subtitles, lang, t)}
            />
            <hr className="mx-1.5 my-1 border-white/10" />
            {subtitles.tracks.map(
              (track, index) =>
                isTextSubtitle(track.codec) && (
                  <Option
                    key={index}
                    name={subtitleName}
                    checked={subtitles.value === index}
                    onSelect={() => subtitles.onChange(index)}
                    {...trackLabel(
                      track,
                      t("player.subtitleTrackNumber", { number: index + 1 }),
                      lang,
                    )}
                  />
                ),
            )}
            {status === "error" && (
              <p className="px-2.5 py-1.5 text-xs text-warn">
                {t("player.subtitleUnavailable")}
              </p>
            )}
          </Column>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A track saved for the clip that is not a text track shows as Off. */
function selectedSubtitle({
  value,
  tracks,
}: NonNullable<Props["subtitles"]>): number {
  return value >= 0 && !isTextSubtitle(tracks[value]?.codec ?? "")
    ? SUBTITLES_OFF
    : value;
}

function autoDetail(
  { audioLanguage, autoTrack, tracks }: NonNullable<Props["subtitles"]>,
  lang: string,
  t: TFunc,
): string {
  if (!audioLanguage) return t("player.subtitleAutoUnknown");
  const track = tracks[autoTrack];
  if (!track) return t("player.subtitleAutoNone");
  return t("player.subtitleAutoMatch", {
    audio: languageName(audioLanguage, lang),
    track: trackLabel(
      track,
      t("player.subtitleTrackNumber", { number: autoTrack + 1 }),
      lang,
    ).label,
  });
}

function Column({
  legend,
  divided = false,
  children,
}: {
  legend: string;
  /** Draw the rule between this column and the next. */
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset
      className={`flex w-60 min-w-0 flex-col gap-0.5 ${
        divided ? "border-r border-white/10 pr-1.5" : ""
      }`}
    >
      <legend className="px-2.5 pb-1.5 pt-2 text-[13px] font-bold">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function Option({
  name,
  checked,
  disabled,
  onSelect,
  label,
  detail,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  label: string;
  detail?: string;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1 hover:bg-white/5 has-checked:bg-white/10 has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-primary">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="peer sr-only"
      />
      <Check
        size={16}
        aria-hidden="true"
        className="invisible shrink-0 peer-checked:visible"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{label}</span>
        {detail && (
          <span className="truncate text-xs text-white/65">{detail}</span>
        )}
      </span>
    </label>
  );
}
