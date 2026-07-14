// Rating star display/editing. 0..5. Click to set; clicking the same value resets to 0.
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  /** Disables interaction (e.g. while a rating mutation is in flight). */
  disabled?: boolean;
}

export function RatingStars({
  value,
  onChange,
  size = 16,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const editable = !!onChange && !disabled;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!editable}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={cn(
            "transition-colors",
            editable ? "cursor-pointer hover:scale-110" : "cursor-default",
          )}
          aria-label={t("rating.star", { n })}
        >
          <Star
            style={{ width: size, height: size }}
            className={n <= value ? "fill-accent2 text-accent2" : "text-muted"}
          />
        </button>
      ))}
    </div>
  );
}
