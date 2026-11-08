import type { SearchQuery } from "@/ipc/types";
import { RESOLUTION_IDS, resolutionLabel } from "@shared/resolutions";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ResolutionFilter({
  value,
  onChange,
}: {
  value: SearchQuery["resolution"];
  onChange: (resolution: SearchQuery["resolution"]) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      <Select
        value={value?.preset ?? "any"}
        onValueChange={(preset) =>
          onChange(
            preset === "any"
              ? undefined
              : {
                  preset: preset as NonNullable<
                    SearchQuery["resolution"]
                  >["preset"],
                  match: value?.match ?? "atLeast",
                },
          )
        }
      >
        <SelectTrigger
          aria-label={t("resolution.title")}
          className="h-8 w-56 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">{t("resolution.any")}</SelectItem>
          {RESOLUTION_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {resolutionLabel(id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <Select
          value={value.match}
          onValueChange={(match) =>
            onChange({ ...value, match: match as "exact" | "atLeast" })
          }
        >
          <SelectTrigger
            aria-label={t("resolution.match")}
            className="h-8 w-28 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="atLeast">{t("resolution.atLeast")}</SelectItem>
            <SelectItem value="exact">{t("resolution.exact")}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
