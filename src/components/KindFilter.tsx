// The kind filter: each kind turns on and off on its own, and "All" clears the
// selection in one click.
//
// Toggle buttons (`aria-pressed`) rather than the radios of SegmentedControl:
// several kinds can be on at once, which a radio group cannot express. A kind
// that is on is tinted, as the filter bar's other toggles are (#586).
import { ButtonGroup } from "@/components/ui/button-group";
import { useI18n } from "@/i18n/I18nProvider";
import { MEDIA_KINDS, kindLabel, normalizeKinds } from "@/lib/mediaKind";
import { cn } from "@/lib/utils";

interface Props {
  value: readonly string[] | undefined;
  /**
   * Already normalized: undefined for every kind, including all of them on, so
   * the toggles fall back to All at once. cleanSearchQuery normalizes again
   * for what is stored.
   */
  onChange: (kinds: string[] | undefined) => void;
}

function Toggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-8 truncate border border-border px-3 text-sm transition-colors",
        pressed
          ? "bg-primary/15 font-medium text-fg"
          : "text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function KindFilter({ value, onChange }: Props) {
  const { t } = useI18n();
  const selected = value ?? [];

  const toggle = (kind: string) =>
    onChange(
      normalizeKinds(
        selected.includes(kind)
          ? selected.filter((k) => k !== kind)
          : [...selected, kind],
      ),
    );

  return (
    <ButtonGroup
      data-slot="kind-group"
      role="group"
      aria-label={t("filter.kindFilter")}
      className="w-fit max-w-full"
    >
      <Toggle
        pressed={selected.length === 0}
        onClick={() => onChange(undefined)}
      >
        {t("filter.all")}
      </Toggle>
      {MEDIA_KINDS.map((kind) => (
        <Toggle
          key={kind}
          pressed={selected.includes(kind)}
          onClick={() => toggle(kind)}
        >
          {kindLabel(t, kind)}
        </Toggle>
      ))}
    </ButtonGroup>
  );
}
