import { useId, useState } from "react";
import type { SearchQuery } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  formatAudioDuration,
  parseAudioDuration,
  type DurationFormat,
} from "@/lib/audioDuration";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type Audio = NonNullable<SearchQuery["audio"]>;
type Mode = NonNullable<Audio["durationMatch"]>;

function useDurationDraft(
  value: number | undefined,
  format: DurationFormat,
  mode: Mode,
) {
  const context = `${format}-${mode}`;
  const [draft, setDraft] = useState({
    source: value,
    context,
    text: formatAudioDuration(value, format),
    invalid: false,
  });
  const current =
    draft.source === value && draft.context === context
      ? draft
      : {
          source: value,
          context,
          text: formatAudioDuration(value, format),
          invalid: false,
        };
  return {
    ...current,
    edit: (text: string) => {
      const parsed = parseAudioDuration(text, format);
      setDraft({
        source: parsed === null ? value : parsed,
        context,
        text,
        invalid: parsed === null,
      });
      return parsed;
    },
  };
}

/** Hooks stay in AudioFilters while its popover closes, preserving invalid drafts. */
export function useAudioDuration(
  audio: Audio | undefined,
  patch: (next: Partial<Audio>) => void,
  t: TFunc,
) {
  const id = useId();
  const [selectOpen, setSelectOpen] = useState<"mode" | "format" | null>(null);
  const [format, setFormat] = useLocalStorage<DurationFormat>(
    "meguri.audioDurationFormat",
    "seconds",
    (raw) => (raw === "minutes" || raw === "time" ? raw : "seconds"),
  );
  const mode: Mode =
    audio?.durationMatch ??
    (audio?.durationMin != null && audio.durationMax != null
      ? audio.durationMin === audio.durationMax
        ? "exact"
        : "between"
      : audio?.durationMin != null
        ? "atLeast"
        : audio?.durationMax != null
          ? "atMost"
          : "between");
  const minimum = useDurationDraft(audio?.durationMin, format, mode);
  const maximum = useDurationDraft(audio?.durationMax, format, mode);
  const reversed =
    mode === "between" &&
    audio?.durationMin != null &&
    audio.durationMax != null &&
    audio.durationMin > audio.durationMax;
  const valid =
    !reversed &&
    (mode === "atMost" || !minimum.invalid) &&
    ((mode !== "between" && mode !== "atMost") || !maximum.invalid);
  const hint = t(
    format === "time"
      ? "audio.durationTimeHint"
      : format === "minutes"
        ? "audio.durationMinutesHint"
        : "audio.durationSecondsHint",
  );
  const input = (bound: "durationMin" | "durationMax", label: string) => {
    const draft = bound === "durationMin" ? minimum : maximum;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-${bound}`} className="text-xs text-muted">
          {label} (
          {t(
            format === "time"
              ? "audio.mmss"
              : format === "minutes"
                ? "audio.minutes"
                : "audio.seconds",
          )}
          )
        </label>
        <input
          id={`${id}-${bound}`}
          type="text"
          inputMode={format === "time" ? "text" : "decimal"}
          value={draft.text}
          aria-invalid={draft.invalid || reversed}
          aria-describedby={`${id}-hint`}
          placeholder={
            format === "time" ? "02:30" : format === "minutes" ? "2.5" : "150"
          }
          onChange={(event) => {
            const value = draft.edit(event.target.value);
            if (value !== null)
              patch(
                mode === "exact"
                  ? {
                      durationMatch: mode,
                      durationMin: value,
                      durationMax: value,
                    }
                  : { durationMatch: mode, [bound]: value },
              );
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-primary aria-invalid:border-error"
        />
      </div>
    );
  };
  const controls = (
    <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-border pt-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-mode`} className="text-xs text-muted">
          {t("audio.durationMatch")}
        </label>
        <Select
          open={selectOpen === "mode"}
          onOpenChange={(open) => setSelectOpen(open ? "mode" : null)}
          value={mode}
          onValueChange={(value) => {
            const next = value as Mode;
            const min = audio?.durationMin ?? audio?.durationMax;
            const max = audio?.durationMax ?? audio?.durationMin;
            patch({
              durationMatch: next,
              durationMin: next === "atMost" ? undefined : min,
              durationMax:
                next === "atLeast" ? undefined : next === "exact" ? min : max,
            });
          }}
        >
          <SelectTrigger id={`${id}-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["exact", "atLeast", "atMost", "between"] as const).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {t(
                    value === "exact"
                      ? "resolution.exact"
                      : value === "atLeast"
                        ? "resolution.atLeast"
                        : value === "atMost"
                          ? "audio.atMost"
                          : "audio.between",
                  )}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-format`} className="text-xs text-muted">
          {t("audio.durationFormat")}
        </label>
        <Select
          open={selectOpen === "format"}
          onOpenChange={(open) => setSelectOpen(open ? "format" : null)}
          value={format}
          onValueChange={(value) => setFormat(value as DurationFormat)}
        >
          <SelectTrigger id={`${id}-format`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seconds">{t("audio.seconds")}</SelectItem>
            <SelectItem value="minutes">{t("audio.minutes")}</SelectItem>
            <SelectItem value="time">{t("audio.minutesSeconds")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode !== "atMost" &&
        input(
          "durationMin",
          t(mode === "exact" ? "media.metaDuration" : "resolution.atLeast"),
        )}
      {(mode === "atMost" || mode === "between") &&
        input("durationMax", t("audio.atMost"))}
      <p id={`${id}-hint`} className="col-span-2 text-xs text-muted">
        {hint}
      </p>
    </div>
  );
  return {
    controls,
    valid,
    error: reversed ? t("audio.durationOrderError") : hint,
    selectOpen: selectOpen != null,
    closeSelect: () => setSelectOpen(null),
  };
}
