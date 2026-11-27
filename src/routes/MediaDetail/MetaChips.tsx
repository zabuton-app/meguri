import { Badge } from "@/components/ui/badge";
import { formatDuration, formatSize } from "@/lib/format";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { hasTimeline, kindLabel } from "@/lib/mediaKind";
import {
  audioInfo,
  channelClass,
  tempoClass,
  type AudioInfo,
} from "@shared/audioInfo";
import { tagValueLabel } from "@/lib/tagLabel";
import {
  cameraName,
  lensName,
  parsePhotoExif,
  shutterLabel,
  type PhotoExif,
} from "@shared/photoInfo";

interface Props {
  detail: FileDetail;
  wsId: string;
  workspaceLabel: string | null;
  workspacePath: string | null;
  /** Total duration in seconds (falls back to the native value when DB duration is empty). */
  total: number | null;
  t: TFunc;
}

/**
 * Metadata badges shown under the player (workspace, kind, resolution, size,
 * duration, codec, fps), for audio what its stored probe output says (#468):
 * format, channels, and the BPM, key and genre written in the file, and for a
 * photo what its EXIF says (#701): camera, lens, exposure and focal length.
 */
export function MetaChips({
  detail,
  wsId,
  workspaceLabel,
  workspacePath,
  total,
  t,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip
        label={t("media.metaWorkspace")}
        value={workspaceLabel ?? wsId}
        title={workspacePath || workspaceLabel || wsId}
      />
      <Chip label={t("media.metaKind")} value={kindLabel(t, detail.kind)} />
      <Chip
        label={t("media.metaResolution")}
        value={
          detail.width && detail.height
            ? `${detail.width}×${detail.height}`
            : "—"
        }
      />
      <Chip label={t("media.metaSize")} value={formatSize(detail.size, "—")} />
      {hasTimeline(detail.kind) && (
        <>
          <Chip
            label={t("media.metaDuration")}
            value={formatDuration(total, { hours: true, fallback: "—" })}
          />
          <Chip label={t("media.metaCodec")} value={detail.codec ?? "—"} />
        </>
      )}
      {detail.kind === "video" && (
        <Chip
          label={t("media.metaFps")}
          value={detail.fps ? detail.fps.toFixed(2) : "—"}
        />
      )}
      {detail.kind === "audio" && <AudioChips meta={detail.meta} t={t} />}
      {detail.kind === "image" && <PhotoChips exif={detail.exif} t={t} />}
    </div>
  );
}

/** A number without a trailing `.0`: 44.1, 48, 128, 96.5. */
const plain = (n: number) => String(Math.round(n * 10) / 10);

function channelsLabel(t: TFunc, channels: number): string {
  const label = tagValueLabel(t, "audio_ch", channelClass(channels));
  return channels > 2 ? `${label} (${channels})` : label;
}

/** A sample rate in kHz, to the hertz: 44.1, 48, 22.05, 11.025. */
const kHz = (rate: number) => `${Number((rate / 1000).toFixed(3))} kHz`;

/** What an audio file's probe output says; a value it does not give is left out. */
function AudioChips({ meta, t }: { meta: unknown; t: TFunc }) {
  const info: AudioInfo | null = audioInfo(meta);
  if (!info) return null;
  const { bits } = info;
  return (
    <>
      {info.sampleRate !== null && (
        <Chip label={t("media.metaSampleRate")} value={kHz(info.sampleRate)} />
      )}
      {bits !== null && (
        <Chip label={t("media.metaBitDepth")} value={`${bits}-bit`} />
      )}
      {info.channels !== null && (
        <Chip
          label={t("media.metaChannels")}
          value={channelsLabel(t, info.channels)}
        />
      )}
      {info.bpm !== null && (
        <Chip
          label={t("media.metaBpm")}
          value={`${plain(info.bpm)} (${tagValueLabel(t, "audio_tempo", tempoClass(info.bpm))})`}
        />
      )}
      {info.key && (
        <Chip
          label={t("media.metaKey")}
          value={`${info.key.name} (${info.key.camelot})`}
        />
      )}
      {info.genres.length > 0 && (
        <Chip label={t("media.metaGenre")} value={info.genres.join(", ")} />
      )}
    </>
  );
}

/** `f/4 · 1/125s · ISO 200`, with only what the photo gives. */
function exposureLabel(exif: PhotoExif): string | null {
  const parts = [
    exif.fNumber !== undefined ? `f/${plain(exif.fNumber)}` : null,
    exif.exposureTime !== undefined ? shutterLabel(exif.exposureTime) : null,
    exif.iso !== undefined ? `ISO ${exif.iso}` : null,
  ].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** `50 mm`, or `6.8 mm (24 mm equiv.)` when the 35 mm figure differs. */
function focalLabel(exif: PhotoExif, t: TFunc): string | null {
  const { focalLength: mm, focalLength35mm: equiv } = exif;
  if (mm === undefined) return null;
  const own = `${plain(mm)} mm`;
  return equiv !== undefined && Math.round(equiv) !== Math.round(mm)
    ? `${own} (${t("media.metaFocalEquiv", { mm: plain(equiv) })})`
    : own;
}

/** What a photo's EXIF says; a value it does not give is left out. */
function PhotoChips({ exif: stored, t }: { exif: unknown; t: TFunc }) {
  const exif = parsePhotoExif(stored);
  if (!exif) return null;
  const camera = cameraName(exif);
  const lens = lensName(exif);
  const exposure = exposureLabel(exif);
  const focal = focalLabel(exif, t);
  return (
    <>
      {camera && <Chip label={t("media.metaCamera")} value={camera} />}
      {lens && <Chip label={t("media.metaLens")} value={lens} />}
      {exposure && <Chip label={t("media.metaExposure")} value={exposure} />}
      {focal && <Chip label={t("media.metaFocalLength")} value={focal} />}
    </>
  );
}

function Chip({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal" title={title}>
      <span className="text-muted">{label}</span>
      <span className="text-fg">{value}</span>
    </Badge>
  );
}
