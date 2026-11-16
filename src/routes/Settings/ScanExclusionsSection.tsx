// Settings: what scans leave out in every workspace (#282). Each pattern is
// a name, a text the path contains, or a regular expression (#529): a name
// by default, since that is what most people mean ("private", "*.tmp").
// A pattern is typed, the listed files it would hide are shown, then it is
// added to the list; the list is saved as a whole. Nothing is saved while a
// pattern cannot be used. Saving hides the indexed files a pattern covers at
// once; files a removed pattern covered come back at the next scan.
import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/ipc/client";
import { invalidateHiddenFiles } from "@/lib/queryCache";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import {
  PATTERN_KINDS,
  patternError,
  samePattern,
  type ExclusionPattern,
  type PatternKind,
} from "@shared/scanExclusions";
import { usePatternPreview, type PreviewState } from "./usePatternPreview";

const KIND_LABELS: Record<PatternKind, TranslationKey> = {
  name: "settings.scanExclusionsKindName",
  contains: "settings.scanExclusionsKindContains",
  regex: "settings.scanExclusionsKindRegex",
};
const KIND_HINTS: Record<PatternKind, TranslationKey> = {
  name: "settings.scanExclusionsKindNameHint",
  contains: "settings.scanExclusionsKindContainsHint",
  regex: "settings.scanExclusionsKindRegexHint",
};
const KIND_PLACEHOLDERS: Record<PatternKind, string> = {
  name: "private",
  contains: "temp",
  regex: "(^|/)private/",
};

/** Common exclusions, put in the field to add in one click. */
const PRESETS: { label: string; pattern: ExclusionPattern }[] = [
  { label: "Synology @eaDir", pattern: { kind: "name", value: "@eaDir" } },
  { label: "#recycle", pattern: { kind: "name", value: "#recycle" } },
  { label: ".DS_Store", pattern: { kind: "name", value: ".DS_Store" } },
  { label: "Thumbs.db", pattern: { kind: "name", value: "Thumbs.db" } },
];

const isBlank = (p: ExclusionPattern) => p.value.trim() === "";

export function ScanExclusionsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const headingId = useId();
  const newId = useId();
  const hintId = useId();
  const state = useQuery({
    queryKey: ["scan_exclusions"],
    queryFn: api.scanExclusionsGet,
  });
  const saved = state.data?.patterns;
  // The user's edit, or null to show what is stored.
  const [draft, setDraft] = useState<ExclusionPattern[] | null>(null);
  const lines = useMemo(() => draft ?? saved ?? [], [draft, saved]);
  // The pattern to add, tried on the listed files before it is.
  const [kind, setKind] = useState<PatternKind>("name");
  const [value, setValue] = useState("");

  const patterns = useMemo(() => lines.filter((l) => !isBlank(l)), [lines]);
  const errors = useMemo(
    () => lines.map((l) => (isBlank(l) ? null : patternError(l))),
    [lines],
  );
  const hasError = errors.some((e) => e !== null);
  const changed =
    saved !== undefined && JSON.stringify(patterns) !== JSON.stringify(saved);
  // Only a name is trimmed: spaces can be what a text or a regex means.
  const candidate = useMemo(
    (): ExclusionPattern => ({
      kind,
      value: kind === "name" ? value.trim() : value,
    }),
    [kind, value],
  );
  const candidateError = isBlank(candidate) ? null : patternError(candidate);
  const duplicate =
    !isBlank(candidate) && lines.some((l) => samePattern(l, candidate));
  const preview = usePatternPreview(
    !isBlank(candidate) && candidateError === null ? candidate : null,
  );
  const editable = saved !== undefined;

  const edit = (at: number, next: string) =>
    setDraft(lines.map((l, i) => (i === at ? { ...l, value: next } : l)));
  const remove = (at: number) => setDraft(lines.filter((_, i) => i !== at));
  // Not one that did not finish: the worker leaves it out for the rest of
  // the session, so every scan would fail with it saved.
  const canAdd =
    editable &&
    !isBlank(candidate) &&
    candidateError === null &&
    !duplicate &&
    preview.status !== "timedOut";
  const add = () => {
    if (!canAdd) return;
    setDraft([...lines, candidate]);
    setValue("");
  };

  const save = useMutation({
    mutationFn: () => api.scanExclusionsSetPatterns(patterns),
    meta: { reportsOwnError: true },
    onSuccess: (next) => {
      qc.setQueryData(["scan_exclusions"], next);
      setDraft(null);
      // Files the patterns cover are hidden now.
      invalidateHiddenFiles(qc);
      toast.success(t("settings.scanExclusionsSaved"));
    },
    onError: () => toast.error(t("settings.scanExclusionsSaveError")),
  });
  const busy = !editable || save.isPending;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-col">
        <h3
          id={headingId}
          className="flex items-center gap-2 text-sm font-semibold text-bright-fg"
        >
          {t("settings.scanExclusions")}
          {/* Every workspace, unlike the folders below: said in words. */}
          <span className="inline-flex h-5 items-center rounded-full border border-border-strong px-2 text-[11px] font-medium text-muted">
            {t("settings.scanExclusionsGlobal")}
          </span>
        </h3>
        <span className="text-xs text-muted">
          {t("settings.scanExclusionsDesc")}
        </span>
      </div>

      {state.isError && (
        <p className="text-xs text-error">
          {t("settings.scanExclusionsLoadError")}
        </p>
      )}

      {editable && lines.length === 0 && (
        <p className="text-xs text-muted">{t("settings.scanExclusionsNone")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {lines.map((line, i) => {
          const error = errors[i];
          return (
            // By position: a key from the text would move focus away while
            // it is typed.
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    error
                      ? "bg-error"
                      : isBlank(line)
                        ? "bg-border-strong"
                        : "bg-success",
                  )}
                />
                <span className="w-20 shrink-0 text-xs text-muted">
                  {t(KIND_LABELS[line.kind])}
                </span>
                <input
                  type="text"
                  value={line.value}
                  onChange={(e) => edit(i, e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  aria-label={t("settings.scanExclusionsPattern", { n: i + 1 })}
                  aria-invalid={error !== null}
                  className={cn(
                    "h-8 min-w-0 flex-1 rounded-md border bg-bg px-2 font-mono text-xs text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    error ? "border-error" : "border-border-strong",
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted"
                  disabled={busy}
                  aria-label={t("settings.scanExclusionsRemove", { n: i + 1 })}
                  title={t("settings.scanExclusionsRemove", { n: i + 1 })}
                  onClick={() => remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
              {error && (
                <p className="ml-24 break-all text-xs text-error">
                  <code className="font-mono">{line.value}</code>: {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
        <label htmlFor={newId} className="text-xs font-semibold text-fg">
          {t("settings.scanExclusionsAdd")}
        </label>
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="sr-only">
            {t("settings.scanExclusionsKind")}
          </legend>
          {PATTERN_KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center rounded-full border px-3 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                kind === k
                  ? "border-primary bg-primary/15 font-medium text-bright-fg"
                  : "border-border-strong text-fg hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name={`${newId}-kind`}
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                disabled={busy}
                className="sr-only"
              />
              {t(KIND_LABELS[k])}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-2">
          <input
            id={newId}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            disabled={busy}
            spellCheck={false}
            placeholder={KIND_PLACEHOLDERS[kind]}
            aria-describedby={hintId}
            aria-invalid={candidateError !== null}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border bg-surface px-2 font-mono text-xs text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              candidateError ? "border-error" : "border-border-strong",
            )}
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={!canAdd || save.isPending}
            onClick={add}
          >
            <Plus />
            {t("settings.scanExclusionsAddAction")}
          </Button>
        </div>
        <p id={hintId} className="text-xs text-muted">
          {t(KIND_HINTS[kind])}
        </p>
        {candidateError ? (
          <p className="break-all text-xs text-error">{candidateError}</p>
        ) : (
          duplicate && (
            <p className="text-xs text-warn">
              {t("settings.scanExclusionsDuplicate")}
            </p>
          )
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">
            {t("settings.scanExclusionsPresets")}
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={busy || lines.some((l) => samePattern(l, p.pattern))}
              title={p.pattern.value}
              aria-label={t("settings.scanExclusionsPresetAdd", {
                pattern: p.label,
              })}
              onClick={() => {
                setKind(p.pattern.kind);
                setValue(p.pattern.value);
              }}
              className="h-7 rounded-full border border-border-strong bg-overlay px-2.5 text-xs text-fg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:border-border disabled:bg-transparent disabled:text-muted"
            >
              {p.label}
            </button>
          ))}
        </div>
        <Preview preview={preview} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {t("settings.scanExclusionsNextScan")}
        </span>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => save.mutate()}
          disabled={!changed || hasError || save.isPending}
        >
          {t("settings.scanExclusionsSave")}
        </Button>
      </div>
    </section>
  );
}

/** The listed files the pattern being typed would hide. */
function Preview({ preview }: { preview: PreviewState }) {
  const { t } = useI18n();
  if (preview.status === "idle") {
    return (
      <p className="text-xs text-muted">
        {t("settings.scanExclusionsPreviewHint")}
      </p>
    );
  }
  let body;
  if (preview.status === "loading" || preview.status === "superseded") {
    body = (
      <p className="text-muted">{t("settings.scanExclusionsPreviewLoading")}</p>
    );
  } else if (preview.status === "error") {
    body = (
      <p className="text-error">{t("settings.scanExclusionsPreviewError")}</p>
    );
  } else if (preview.status === "timedOut") {
    body = (
      <p className="text-warn">{t("settings.scanExclusionsTestTimedOut")}</p>
    );
  } else if (preview.total === 0) {
    body = <p>{t("settings.scanExclusionsPreviewNone")}</p>;
  } else {
    const more = preview.total - preview.files.length;
    body = (
      <>
        <p className="font-medium text-primary">
          {t("settings.scanExclusionsPreviewCount", { count: preview.total })}
        </p>
        <ul
          aria-label={t("settings.scanExclusionsPreviewList")}
          className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border bg-surface py-1"
        >
          {preview.files.map((f, i) => (
            <li
              // By position: a workspace inside another lists a file twice.
              key={i}
              title={f.absPath}
              className="flex min-w-0 gap-2 px-2 py-0.5 font-mono text-[11px]"
            >
              <span className="shrink-0 text-muted">{f.workspace}</span>
              <span className="w-0 min-w-0 flex-1 truncate text-fg">
                {f.path}
              </span>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <p className="text-muted">
            {t("settings.scanExclusionsPreviewMore", { count: more })}
          </p>
        )}
      </>
    );
  }
  return (
    <div aria-live="polite" className="flex flex-col gap-1 text-xs">
      {body}
    </div>
  );
}
