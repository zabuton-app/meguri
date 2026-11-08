import { useEffect, useId, useState } from "react";
import { Clock, ChevronDown } from "lucide-react";
import { RECENT_PERIODS, type RecentFiles } from "@shared/recentFiles";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  RECENT_BASIS_KEY,
  recentBasis,
  saveRecentView,
} from "@/lib/recentFiles";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function RecentFilesFilter({
  value,
  onChange,
  rememberView,
}: {
  value: RecentFiles | undefined;
  onChange: (value: RecentFiles | undefined) => void;
  rememberView: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [basis, setBasis] = useLocalStorage(
    RECENT_BASIS_KEY,
    "added",
    recentBasis,
  );
  const [openSelect, setOpenSelect] = useState<"period" | "basis" | null>(null);
  useEffect(() => {
    if (rememberView) saveRecentView(value);
  }, [value, rememberView]);
  const activeBasis = value?.basis;
  useEffect(() => {
    if (activeBasis) setBasis(activeBasis);
  }, [activeBasis, setBasis]);
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setOpenSelect(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-fg"
        >
          <Clock className="size-4" />
          {t("recent.title")}
          {value && (
            <span className="text-primary">{t(`recent.${value.period}`)}</span>
          )}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={t("recent.title")}
        className="w-80 space-y-3"
        onEscapeKeyDown={(event) => {
          if (openSelect) {
            event.preventDefault();
            setOpenSelect(null);
          }
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-period`} className="text-xs text-muted">
            {t("recent.window")}
          </label>
          <Select
            open={openSelect === "period"}
            onOpenChange={(open) => setOpenSelect(open ? "period" : null)}
            value={value?.period ?? "any"}
            onValueChange={(period) =>
              onChange(
                period === "any"
                  ? undefined
                  : {
                      period: period as RecentFiles["period"],
                      basis: value?.basis ?? basis,
                    },
              )
            }
          >
            <SelectTrigger id={`${id}-period`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t("filter.all")}</SelectItem>
              {RECENT_PERIODS.map((period) => (
                <SelectItem value={period} key={period}>
                  {t(`recent.${period}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-basis`} className="text-xs text-muted">
            {t("recent.basis")}
          </label>
          <Select
            open={openSelect === "basis"}
            onOpenChange={(open) => setOpenSelect(open ? "basis" : null)}
            value={value?.basis ?? basis}
            onValueChange={(raw) => {
              const next = recentBasis(raw);
              setBasis(next);
              if (value) onChange({ ...value, basis: next });
            }}
          >
            <SelectTrigger id={`${id}-basis`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="added">{t("recent.added")}</SelectItem>
              <SelectItem value="created">{t("recent.created")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted">
          {t(
            (value?.basis ?? basis) === "added"
              ? "recent.addedHint"
              : "recent.createdHint",
          )}
        </p>
        <p className="text-xs text-muted">{t("recent.calendarHint")}</p>
      </PopoverContent>
    </Popover>
  );
}
