import { useEffect, useId, useState, type ReactNode } from "react";
import { AudioLines, ChevronDown } from "lucide-react";
import type { SearchQuery } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { describeAudioFilters } from "@/lib/audioFilters";
import {
  AUDIO_CODECS,
  audioCodecLabel,
  sampleRateLabel,
} from "@shared/audioMetadata";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useAudioDuration } from "./useAudioDuration";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type Audio = NonNullable<SearchQuery["audio"]>;

export function AudioFilters({
  value,
  onChange,
  onValidityChange,
}: {
  value: SearchQuery["audio"];
  onChange: (audio: SearchQuery["audio"]) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [selectOpen, setSelectOpen] = useState<keyof Audio | null>(null);
  const count = describeAudioFilters(t, value).length;
  const patch = (p: Partial<Audio>) => {
    const next = Object.fromEntries(
      Object.entries({ ...value, ...p }).filter(([, v]) => v != null),
    );
    if (next.sampleRate == null) delete next.sampleRateMatch;
    if (next.bitDepth == null) delete next.bitDepthMatch;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const duration = useAudioDuration(value, patch, t);
  useEffect(
    () => onValidityChange(duration.valid),
    [duration.valid, onValidityChange],
  );
  const field = (key: keyof Audio, label: string, control: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1.5" key={key}>
      <label htmlFor={`${id}-${key}`} className="text-xs text-muted">
        {label}
      </label>
      {control}
    </div>
  );
  const select = (
    key: "sampleRate" | "bitDepth" | "channels" | "codec",
    label: string,
    options: { value: string; label: string }[],
  ) => {
    const matchKey =
      key === "sampleRate"
        ? "sampleRateMatch"
        : key === "bitDepth"
          ? "bitDepthMatch"
          : null;
    return field(
      key,
      label,
      <>
        <Select
          open={selectOpen === key}
          onOpenChange={(open) => setSelectOpen(open ? key : null)}
          value={String(value?.[key] ?? "any")}
          onValueChange={(v) =>
            patch({
              [key]:
                v === "any"
                  ? undefined
                  : key === "sampleRate" || key === "bitDepth"
                    ? Number(v)
                    : v,
            })
          }
        >
          <SelectTrigger id={`${id}-${key}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("audio.any")}</SelectItem>
            {options.map((option) => (
              <SelectItem value={option.value} key={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {matchKey && value?.[key] != null && (
          <Select
            open={selectOpen === matchKey}
            onOpenChange={(open) => setSelectOpen(open ? matchKey : null)}
            value={value?.[matchKey] ?? "exact"}
            onValueChange={(match) =>
              patch({ [matchKey]: match as "exact" | "atLeast" })
            }
          >
            <SelectTrigger
              aria-label={t(
                matchKey === "sampleRateMatch"
                  ? "audio.sampleRateMatch"
                  : "audio.bitDepthMatch",
              )}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exact">{t("resolution.exact")}</SelectItem>
              <SelectItem value="atLeast">{t("resolution.atLeast")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </>,
    );
  };
  const number = (
    key: "bitRateMin" | "durationMin" | "durationMax",
    label: string,
    scale = 1,
  ) =>
    field(
      key,
      label,
      <input
        id={`${id}-${key}`}
        type="number"
        min={0}
        step="any"
        value={value?.[key] == null ? "" : value[key] / scale}
        placeholder={t("audio.any")}
        onChange={(event) => {
          const n = event.target.valueAsNumber;
          patch({
            [key]: Number.isFinite(n) && n >= 0 ? n * scale : undefined,
          });
        }}
        className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
      />,
    );
  return (
    <>
      <Popover
        onOpenChange={(open) => {
          if (!open) {
            setSelectOpen(null);
            duration.closeSelect();
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-fg"
          >
            <AudioLines className="size-4" />
            {t("audio.filters")}
            {count > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-primary-foreground">
                {count}
              </span>
            )}
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={t("audio.filters")}
          className="grid max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(28rem,calc(100vw-2rem))] grid-cols-2 gap-3 overflow-y-auto"
          onEscapeKeyDown={(event) => {
            if (selectOpen || duration.selectOpen) {
              event.preventDefault();
              setSelectOpen(null);
              duration.closeSelect();
            }
          }}
        >
          {select(
            "sampleRate",
            t("audio.sampleRate"),
            [
              8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000,
              176400, 192000, 352800, 384000,
            ].map((rate) => ({
              value: String(rate),
              label: sampleRateLabel(rate),
            })),
          )}
          {select(
            "bitDepth",
            t("audio.bitDepth"),
            [8, 16, 24, 32, 64].map((bits) => ({
              value: String(bits),
              label: t("audio.bits", { count: bits }),
            })),
          )}
          {select(
            "channels",
            t("audio.channels"),
            ["mono", "stereo", "multichannel"].map((channels) => ({
              value: channels,
              label: t(
                `audio.${channels}` as
                  "audio.mono" | "audio.stereo" | "audio.multichannel",
              ),
            })),
          )}
          {select(
            "codec",
            t("media.metaCodec"),
            AUDIO_CODECS.map((codec) => ({
              value: codec,
              label: audioCodecLabel(codec),
            })),
          )}
          {duration.controls}
          {number("bitRateMin", t("audio.bitRateMin"), 1000)}
          <p className="self-end text-xs text-muted">
            {t("audio.unknownHint")}
          </p>
        </PopoverContent>
      </Popover>
      {!duration.valid && (
        <p role="alert" className="text-xs text-error">
          {duration.error}
        </p>
      )}
    </>
  );
}
