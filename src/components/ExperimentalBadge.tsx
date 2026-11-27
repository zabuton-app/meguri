// The mark of an experimental feature: a beaker, wherever the feature is
// offered or opens. Its title says what experimental means.
//
// Next to a name (a title), use ExperimentalBadge. On a control, wrap it in
// ExperimentalCorner: the beaker overhangs the control's top-right corner, and
// as a sibling of the control rather than its child it neither joins the
// control's name nor fades with it when the control is disabled.
import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export function ExperimentalBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  const label = t("common.experimental");
  return (
    <FlaskConical
      role="img"
      aria-label={label}
      data-slot="experimental-badge"
      className={cn("size-3.5 shrink-0 text-primary", className)}
    >
      <title>{label}</title>
    </FlaskConical>
  );
}

export function ExperimentalCorner({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      <span className="absolute -right-2 -top-2 flex size-[18px] items-center justify-center rounded-full bg-primary shadow-sm ring-2 ring-surface">
        <ExperimentalBadge className="size-3 text-primary-foreground" />
      </span>
    </span>
  );
}
