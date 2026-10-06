// Editor for one pattern rule, with a live test of it against the library's own
// file names.
import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  CASE_MODES,
  MAX_AUTO_TAG_PATTERN,
  MAX_AUTO_TAG_RULE_NAME,
  MAX_AUTO_TAG_TEMPLATE,
  compilePattern,
  compileRule,
  runRule,
  type CaseMode,
  type TagRule,
} from "@shared/autoTag";
import { segments } from "@shared/autoTagAnalysis";
import { ExcludeList } from "./ExcludeList";
import { FIELD, MAX_ROWS, MONO, ruleDisplayName } from "./helpers";
import { useViewState } from "./viewState";
import { Chip, Highlighted, MoreRows, Segmented, SmallButton } from "./parts";

const CASE_LABELS: Record<CaseMode, TranslationKey> = {
  keep: "autoTag.case.keep",
  lower: "autoTag.case.lower",
  upper: "autoTag.case.upper",
};

export function RuleEditor({
  rule,
  names,
  onChange,
  onDelete,
}: {
  rule: TagRule;
  /** The names the rule is tested against (none in safe mode). */
  names: readonly string[];
  onChange: (change: Partial<TagRule>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [onlyMatches, setOnlyMatches] = useViewState(
    "regex.onlyMatches",
    false,
  );

  const pattern = compilePattern(rule.pattern, rule.ci);
  const patternError = rule.pattern && "error" in pattern ? pattern.error : "";

  const test = useMemo(() => {
    const compiled = compileRule(rule);
    let tagged = 0;
    const rows = names.map((name) => {
      const hits = compiled ? runRule(compiled, name) : [];
      const tags = [...new Set(hits.flatMap((hit) => hit.tags))];
      if (tags.length > 0) tagged++;
      return { name, hits, tags };
    });
    return { tagged, rows };
  }, [names, rule]);
  const shown = onlyMatches
    ? test.rows.filter((row) => row.hits.length > 0)
    : test.rows;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("autoTag.ruleName")}</span>
          <input
            className={FIELD}
            value={rule.name}
            placeholder={ruleDisplayName(t, { ...rule, name: "" })}
            maxLength={MAX_AUTO_TAG_RULE_NAME}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("autoTag.template")}</span>
          <input
            className={cn(FIELD, MONO)}
            value={rule.template}
            maxLength={MAX_AUTO_TAG_TEMPLATE}
            spellCheck={false}
            onChange={(e) => onChange({ template: e.target.value })}
          />
        </label>
        <label className="col-span-full flex flex-col gap-1">
          <span className="text-xs text-muted">{t("autoTag.pattern")}</span>
          <input
            className={cn(
              MONO,
              "h-[34px] rounded-md border bg-black/25 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              patternError
                ? "border-error text-error"
                : "border-border-strong text-accent2",
            )}
            value={rule.pattern}
            maxLength={MAX_AUTO_TAG_PATTERN}
            spellCheck={false}
            aria-invalid={patternError !== ""}
            onChange={(e) => onChange({ pattern: e.target.value })}
          />
          {patternError && (
            <span role="alert" className="text-xs text-error">
              {patternError}
            </span>
          )}
        </label>
        <ExcludeList
          // Per rule: the value being typed belongs to the list it is for.
          key={rule.id}
          exclude={rule.exclude}
          onChange={(exclude) => onChange({ exclude })}
          t={t}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("autoTag.letterCase")}</span>
          <Segmented
            label={t("autoTag.letterCase")}
            value={rule.caseMode}
            onChange={(caseMode) => onChange({ caseMode })}
            options={CASE_MODES.map((value) => ({
              value,
              label: t(CASE_LABELS[value]),
            }))}
          />
        </div>
        <div className="col-span-full flex flex-wrap gap-x-5 gap-y-2">
          {(
            [
              ["ci", "autoTag.ignoreCase"],
              ["split", "autoTag.split"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-fg"
            >
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={rule[key]}
                onChange={(e) => onChange({ [key]: e.target.checked })}
              />
              {t(label)}
            </label>
          ))}
          <SmallButton
            variant="ghost"
            className="ml-auto h-[26px] hover:text-error"
            onClick={onDelete}
          >
            {t("autoTag.deleteRule")}
          </SmallButton>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <span className="text-xs font-semibold text-fg">
            {t("autoTag.liveTest")}
          </span>
          <span className="text-xs tabular-nums text-muted">
            {t("autoTag.liveTestSummary", {
              tagged: test.tagged,
              total: names.length,
            })}
          </span>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-fg">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={onlyMatches}
              onChange={(e) => setOnlyMatches(e.target.checked)}
            />
            {t("autoTag.onlyMatches")}
          </label>
        </div>
        <ul className="flex flex-col">
          {shown.slice(0, MAX_ROWS).map((row, i) => (
            <li
              key={i}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-surface px-3 py-1.5",
                row.hits.length === 0 && "opacity-50",
              )}
            >
              <span
                className={cn(
                  MONO,
                  "min-w-0 flex-[1_1_280px] break-all text-[13px] text-fg",
                )}
              >
                <Highlighted
                  segs={segments(
                    row.name,
                    row.hits.map((hit) => ({
                      ...hit,
                      muted: hit.tags.length === 0,
                    })),
                  )}
                />
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {row.tags.length > 0 && (
                  <span className="text-xs text-muted">→</span>
                )}
                {row.tags.map((tag) => (
                  <Chip key={tag}>{tag}</Chip>
                ))}
                {row.hits.length > 0 && row.tags.length === 0 && (
                  <span className="text-[11px] text-muted">
                    {t("autoTag.excluded")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <MoreRows t={t} hidden={shown.length - MAX_ROWS} />
      </div>
    </section>
  );
}
