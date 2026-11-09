import { Badge } from "@/components/ui/badge";
import { formatDuration, formatSize } from "@/lib/format";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { hasTimeline, kindLabel } from "@/lib/mediaKind";
import { readAudioMetadata, sampleRateLabel } from "@shared/audioMetadata";

interface Props {
  detail: FileDetail;
  wsId: string;
  workspaceLabel: string | null;
  workspacePath: string | null;
  /** Total duration in seconds (falls back to the native value when DB duration is empty). */
  total: number | null;
  t: TFunc;
}

/** Metadata badges shown under the player (workspace, kind, resolution, size, duration, codec, fps). */
export function MetaChips({
  detail,
  wsId,
  workspaceLabel,
  workspacePath,
  total,
  t,
}: Props) {
  const audio = detail.kind === "audio" ? readAudioMetadata(detail.meta) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip
        label={t("media.metaWorkspace")}
        value={workspaceLabel ?? wsId}
        title={workspacePath || workspaceLabel || wsId}
      />
      <Chip label={t("media.metaKind")} value={kindLabel(t, detail.kind)} />
      {detail.kind !== "audio" && (
        <Chip
          label={t("media.metaResolution")}
          value={
            detail.width && detail.height
              ? `${detail.width}×${detail.height}`
              : "—"
          }
        />
      )}
      {audio && (
        <>
          <Chip
            label={t("audio.sampleRate")}
            value={audio.sampleRate ? sampleRateLabel(audio.sampleRate) : "—"}
          />
          <Chip
            label={t("audio.bitDepth")}
            value={
              audio.bitDepth ? t("audio.bits", { count: audio.bitDepth }) : "—"
            }
          />
          <Chip
            label={t("audio.channels")}
            value={
              audio.channels === 1
                ? t("audio.mono")
                : audio.channels === 2
                  ? t("audio.stereo")
                  : audio.channels
                    ? t("audio.channelCount", { count: audio.channels })
                    : "—"
            }
          />
          <Chip
            label={t("audio.bitRate")}
            value={
              audio.bitRate ? `${Math.round(audio.bitRate / 1000)} kbps` : "—"
            }
          />
        </>
      )}
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
    </div>
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
