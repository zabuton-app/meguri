import { Badge } from "@/components/ui/badge";
import { formatDuration, formatSize } from "@/lib/format";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { hasTimeline, kindLabel } from "@/lib/mediaKind";
import { audioInfo, type AudioInfo } from "@shared/audioInfo";

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
 * duration, codec, fps), and for audio what its stored probe output says
 * (#468): format, channels, and the BPM, key and genre written in the file.
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
    </div>
  );
}

/** A number without a trailing `.0`: 44.1, 48, 128, 96.5. */
const plain = (n: number) => String(Math.round(n * 10) / 10);

function channelsLabel(t: TFunc, channels: number): string {
  if (channels === 1) return t("tags.value.chMono");
  if (channels === 2) return t("tags.value.chStereo");
  return `${t("tags.value.chSurround")} (${channels})`;
}

/** What an audio file's probe output says; a value it does not give is left out. */
function AudioChips({ meta, t }: { meta: unknown; t: TFunc }) {
  const info: AudioInfo | null = audioInfo(meta);
  if (!info) return null;
  // A float sample's size says nothing of the source's depth, and lossy
  // codecs report none.
  const bits = info.codec.startsWith("pcm_f") ? null : info.bits;
  return (
    <>
      {info.sampleRate !== null && (
        <Chip
          label={t("media.metaSampleRate")}
          value={`${plain(info.sampleRate / 1000)} kHz`}
        />
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
        <Chip label={t("media.metaBpm")} value={plain(info.bpm)} />
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
