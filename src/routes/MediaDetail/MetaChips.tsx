import { Badge } from "@/components/ui/badge";
import { formatDuration, formatSize } from "@/lib/format";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { kindLabelKey } from "@/lib/mediaKind";

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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip
        label={t("media.metaWorkspace")}
        value={workspaceLabel ?? wsId}
        title={workspacePath || workspaceLabel || wsId}
      />
      <Chip label={t("media.metaKind")} value={t(kindLabelKey(detail.kind))} />
      <Chip
        label={t("media.metaResolution")}
        value={
          detail.width && detail.height
            ? `${detail.width}×${detail.height}`
            : "—"
        }
      />
      <Chip label={t("media.metaSize")} value={formatSize(detail.size, "—")} />
      {detail.kind === "video" && (
        <>
          <Chip
            label={t("media.metaDuration")}
            value={formatDuration(total, { hours: true, fallback: "—" })}
          />
          <Chip label={t("media.metaCodec")} value={detail.codec ?? "—"} />
          <Chip
            label={t("media.metaFps")}
            value={detail.fps ? detail.fps.toFixed(2) : "—"}
          />
        </>
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
