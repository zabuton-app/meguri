// What the colours, rings and lines on the canvas mean.
import { useI18n } from "@/i18n/I18nProvider";
import { kindLabelKey } from "@/lib/mediaKind";
import { EDGE_SOURCE_INFO } from "./edgeSources";
import { NodeDot } from "./NodeDot";

export function GraphLegend({ showAutoTags }: { showAutoTags: boolean }) {
  const { t } = useI18n();
  const kinds = ["video", "image", "audio"] as const;
  return (
    <section
      aria-label={t("graph.legend.title")}
      className="pointer-events-auto flex flex-col gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-2.5 text-xs text-secondary-fg shadow-md"
    >
      {kinds.map((kind) => {
        const key = kindLabelKey(kind);
        return (
          <div key={kind} className="flex items-center gap-2">
            <NodeDot type="file" fileKind={kind} />
            {key ? t(key) : kind}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <NodeDot type="tag" />
        {t("graph.legend.tag")}
      </div>
      {showAutoTags && (
        <div className="flex items-center gap-2">
          <NodeDot type="tag" auto />
          {t("graph.legend.autoTag")}
        </div>
      )}
      <div className="my-0.5 h-px bg-border" />
      {EDGE_SOURCE_INFO.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <span
            aria-hidden
            className={
              s.line === "dashed"
                ? "w-4 border-t-2 border-dashed border-info"
                : "h-px w-4 bg-muted"
            }
          />
          {t(s.label)}
        </div>
      ))}
    </section>
  );
}
