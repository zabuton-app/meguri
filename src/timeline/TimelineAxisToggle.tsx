// The date the timeline runs along, one of TIMELINE_AXES (in their order).
import { SegmentedControl } from "@/components/SegmentedControl";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { TIMELINE_AXES, type TimelineAxis } from "@shared/ipc/timeline";

const AXIS_LABEL: Record<TimelineAxis, TranslationKey> = {
  btime: "timeline.axis.btime",
  added: "timeline.axis.added",
  captured: "timeline.axis.captured",
};

export function TimelineAxisToggle({
  axis,
  onChange,
  className,
}: {
  axis: TimelineAxis;
  onChange: (axis: TimelineAxis) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <SegmentedControl
      value={axis}
      options={TIMELINE_AXES.map((value) => ({
        value,
        label: t(AXIS_LABEL[value]),
      }))}
      onChange={onChange}
      label={t("timeline.axis.label")}
      slot="timeline-axis"
      className={className}
    />
  );
}
