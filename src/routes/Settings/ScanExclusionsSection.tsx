// Settings: what scans leave out in every workspace (#282), as regular
// expressions, one per line. Each line is checked as it is typed; nothing is
// saved while one does not compile. Saving hides the indexed files a pattern
// covers at once; files a removed pattern covered come back at the next scan.
import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/ipc/client";
import { invalidateFileCaches } from "@/lib/queryCache";
import { useI18n } from "@/i18n/I18nProvider";
import { patternError } from "@shared/scanExclusions";

const EXAMPLES = ["(^|/)@eaDir/", "(^|/)#recycle/", "(^|/)proxy/"];

/** The patterns in the text: one per line, blank lines left out. */
function patternsOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
}

export function ScanExclusionsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fieldId = useId();
  const state = useQuery({
    queryKey: ["scan_exclusions"],
    queryFn: api.scanExclusionsGet,
  });
  const saved = state.data?.patterns;
  // The user's edit, or null to show what is stored.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved?.join("\n") ?? null;

  const patterns = useMemo(() => patternsOf(text ?? ""), [text]);
  const errors = useMemo(
    () =>
      patterns.flatMap((p) => {
        const error = patternError(p);
        return error === null ? [] : [{ pattern: p, error }];
      }),
    [patterns],
  );
  const changed =
    saved !== undefined && patterns.join("\n") !== saved.join("\n");

  const save = useMutation({
    mutationFn: () => api.scanExclusionsSetPatterns(patterns),
    meta: { reportsOwnError: true },
    onSuccess: (next) => {
      qc.setQueryData(["scan_exclusions"], next);
      setDraft(null);
      // Files the patterns cover are hidden now, from the lists and Missing.
      invalidateFileCaches(qc);
      void qc.invalidateQueries({ queryKey: ["missing_files"] });
      toast.success(t("settings.scanExclusionsSaved"));
    },
    onError: () => toast.error(t("settings.scanExclusionsSaveError")),
  });

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex flex-col">
        <label
          htmlFor={fieldId}
          className="text-sm font-semibold text-bright-fg"
        >
          {t("settings.scanExclusions")}
        </label>
        <span className="text-xs text-muted">
          {t("settings.scanExclusionsDesc")}
        </span>
      </div>
      <textarea
        id={fieldId}
        value={text ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        disabled={text === null || save.isPending}
        rows={5}
        spellCheck={false}
        placeholder={EXAMPLES.join("\n")}
        aria-invalid={errors.length > 0}
        className="w-full resize-y rounded-md border border-border-strong bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      {state.isError && (
        <p className="text-xs text-error">
          {t("settings.scanExclusionsLoadError")}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-error">
          {errors.map(({ pattern, error }, i) => (
            // By position: the same wrong line can be there twice.
            <li key={i} className="break-all">
              <code className="font-mono">{pattern}</code>: {error}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {t("settings.scanExclusionsNextScan")}
        </span>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => save.mutate()}
          disabled={!changed || errors.length > 0 || save.isPending}
        >
          {t("settings.scanExclusionsSave")}
        </Button>
      </div>
    </section>
  );
}
