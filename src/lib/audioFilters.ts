import type { SearchQuery } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { audioCodecLabel, sampleRateLabel } from "@shared/audioMetadata";

type Audio = NonNullable<SearchQuery["audio"]>;

/** Shared labels for the active chips and saved-bin summaries. */
export function describeAudioFilters(
  t: TFunc,
  audio: Audio | undefined,
): { key: keyof Audio; label: string }[] {
  if (!audio) return [];
  const out: { key: keyof Audio; label: string }[] = [];
  if (audio.sampleRate != null)
    out.push({
      key: "sampleRate",
      label: `${t("audio.sampleRate")}: ${audio.sampleRateMatch === "atLeast" ? "≥ " : ""}${sampleRateLabel(audio.sampleRate)}`,
    });
  if (audio.bitDepth != null)
    out.push({
      key: "bitDepth",
      label: `${audio.bitDepthMatch === "atLeast" ? "≥ " : ""}${t("audio.bits", { count: audio.bitDepth })}`,
    });
  if (audio.channels)
    out.push({ key: "channels", label: t(`audio.${audio.channels}`) });
  if (audio.codec)
    out.push({
      key: "codec",
      label: `${t("media.metaCodec")}: ${audioCodecLabel(audio.codec)}`,
    });
  if (audio.bitRateMin != null)
    out.push({
      key: "bitRateMin",
      label: `${t("audio.bitRate")}: ≥ ${audio.bitRateMin / 1000} kbps`,
    });
  const exactDuration =
    audio.durationMin != null && audio.durationMin === audio.durationMax;
  if (exactDuration)
    out.push({
      key: "durationMin",
      label: `${t("media.metaDuration")}: ${t("audio.exact")} ${audio.durationMin} s`,
    });
  if (audio.durationMin != null && !exactDuration)
    out.push({
      key: "durationMin",
      label: `${t("media.metaDuration")}: ≥ ${audio.durationMin} s`,
    });
  if (audio.durationMax != null && !exactDuration)
    out.push({
      key: "durationMax",
      label: `${t("media.metaDuration")}: ≤ ${audio.durationMax} s`,
    });
  return out;
}
