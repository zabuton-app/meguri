// Rules tab: the pattern rules, an editor for the selected one, and a live test
// of it against the library's own file names.
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  CASE_MODES,
  MAX_AUTO_TAG_EXCLUDE,
  MAX_AUTO_TAG_PATTERN,
  MAX_AUTO_TAG_RULES,
  MAX_AUTO_TAG_RULE_NAME,
  MAX_AUTO_TAG_TEMPLATE,
  compilePattern,
  compileRule,
  runRule,
  type CaseMode,
  type RuleKind,
  type TagRule,
} from "@shared/autoTag";
import { segments } from "@shared/autoTagAnalysis";
import { FIELD, MAX_ROWS, MONO, ruleDisplayName } from "./helpers";
import {
  Badge,
  Chip,
  Highlighted,
  MoreRows,
  Notice,
  Segmented,
  SmallButton,
  TabScroll,
  Toolbar,
} from "./parts";
import type { AutoTagState } from "./useAutoTag";

const KIND_LABELS: Record<RuleKind, TranslationKey> = {
  prefix: "autoTag.kind.prefix",
  bracket: "autoTag.kind.bracket",
  regex: "autoTag.kind.regex",
};

const CASE_LABELS: Record<CaseMode, TranslationKey> = {
  keep: "autoTag.case.keep",
  lower: "autoTag.case.lower",
  upper: "autoTag.case.upper",
};

// Per rule object and per names array: editing one rule leaves the counts of
// the others alone. Outside React on purpose — it is a pure memo.
const countCache = new WeakMap<
  TagRule,
  { names: readonly string[]; count: number }
>();

const NO_NAMES: readonly string[] = [];

/** Files a rule would tag. */
function countTagged(rule: TagRule, names: readonly string[]): number {
  const cached = countCache.get(rule);
  if (cached?.names === names) return cached.count;
  let count = 0;
  const compiled = compileRule(rule);
  if (compiled) {
    for (const name of names) {
      if (runRule(compiled, name).some((hit) => hit.tags.length > 0)) count++;
    }
  }
  countCache.set(rule, { names, count });
  return count;
}

export function RulesTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { config, update, names } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ files: number; added: number } | null>(
    null,
  );

  const selected =
    config.rules.find((rule) => rule.id === selectedId) ?? config.rules[0];

  // In safe mode no rule is run against the library: one of them hung the
  // screen, and it has to stay editable until it is found.
  const tested = state.safeMode ? NO_NAMES : names;
  const counts = (rule: TagRule) => countTagged(rule, tested);

  const patch = (id: string, change: Partial<TagRule>) => {
    setResult(null);
    update((c) => ({
      ...c,
      rules: c.rules.map((rule) =>
        rule.id === id ? { ...rule, ...change } : rule,
      ),
    }));
  };

  const addRule = () => {
    const id = crypto.randomUUID();
    update((c) => ({
      ...c,
      rules: [
        ...c.rules,
        {
          id,
          name: t("autoTag.rule.new"),
          kind: "regex",
          pattern: "",
          template: "$1",
          exclude: "",
          ci: false,
          split: false,
          caseMode: "keep",
          enabled: true,
        },
      ],
    }));
    setSelectedId(id);
  };

  const reapply = async () => {
    const ok = await confirm({
      title: t("autoTag.reapply"),
      message: t("autoTag.reapplyConfirm", { count: state.total }),
      confirmText: t("autoTag.reapply"),
    });
    if (!ok) return;
    setBusy(true);
    setResult(await state.reapply());
    setBusy(false);
  };

  const pattern = selected
    ? compilePattern(selected.pattern, selected.ci)
    : null;
  const patternError =
    selected && selected.pattern && pattern && "error" in pattern
      ? pattern.error
      : "";

  const test = useMemo(() => {
    const compiled = selected ? compileRule(selected) : null;
    let tagged = 0;
    const rows = tested.map((name) => {
      const hits = compiled ? runRule(compiled, name) : [];
      const tags = [...new Set(hits.flatMap((hit) => hit.tags))];
      if (tags.length > 0) tagged++;
      return { name, hits, tags };
    });
    return { tagged, rows };
  }, [tested, selected]);
  const shown = onlyMatches
    ? test.rows.filter((row) => row.hits.length > 0)
    : test.rows;

  return (
    <>
      <Toolbar>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
          <Switch
            checked={config.applyOnScan}
            onCheckedChange={(applyOnScan) =>
              update((c) => ({ ...c, applyOnScan }))
            }
          />
          {t("autoTag.applyOnScan")}
        </label>
        <span className="text-xs text-muted">
          {t("autoTag.applyOnScanHint")}
        </span>
        <SmallButton
          className="ml-auto"
          disabled={busy}
          onClick={() => void reapply()}
        >
          {busy ? t("autoTag.reapplying") : t("autoTag.reapply")}
        </SmallButton>
      </Toolbar>
      {result && (
        <Notice>
          {t("autoTag.reapplyDone", {
            files: result.files,
            added: result.added,
          })}
        </Notice>
      )}

      <TabScroll className="@container flex flex-wrap">
        <>
          <aside className="flex flex-[1_1_300px] flex-col gap-0.5 border-b border-border p-3 @[760px]:max-w-[380px] @[760px]:border-b-0 @[760px]:border-r">
            <div className="flex items-baseline gap-2 px-1 pb-2 pt-0.5">
              <span className="text-xs font-semibold text-fg">
                {t("autoTag.patternRules")}
              </span>
              <span className="text-xs text-muted">
                {t("autoTag.evaluatedInOrder")}
              </span>
            </div>
            {config.rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg p-2",
                  rule.id === selected?.id ? "bg-overlay" : "hover:bg-surface",
                )}
              >
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => patch(rule.id, { enabled })}
                  aria-label={t("autoTag.ruleEnabled")}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(rule.id)}
                  aria-current={rule.id === selected?.id}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "truncate text-[13px]",
                          rule.enabled ? "text-bright-fg" : "text-muted",
                        )}
                      >
                        {ruleDisplayName(t, rule)}
                      </span>
                      <Badge>{t(KIND_LABELS[rule.kind])}</Badge>
                    </span>
                    <span
                      className={cn(MONO, "truncate text-[11px] text-muted")}
                    >
                      {rule.pattern}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {t("autoTag.fileCount", { count: counts(rule) })}
                  </span>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addRule}
              disabled={config.rules.length >= MAX_AUTO_TAG_RULES}
              className="mt-2 h-8 rounded-lg border border-dashed border-border-strong text-xs text-muted transition hover:text-bright-fg disabled:opacity-40"
            >
              {t("autoTag.addRule")}
            </button>
          </aside>

          {selected && (
            <section className="flex min-w-0 flex-[3_1_460px] flex-col gap-4 px-5 py-4">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-4 gap-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {t("autoTag.ruleName")}
                  </span>
                  <input
                    className={FIELD}
                    value={selected.name}
                    placeholder={ruleDisplayName(t, { ...selected, name: "" })}
                    maxLength={MAX_AUTO_TAG_RULE_NAME}
                    onChange={(e) =>
                      patch(selected.id, { name: e.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {t("autoTag.template")}
                  </span>
                  <input
                    className={cn(FIELD, MONO)}
                    value={selected.template}
                    maxLength={MAX_AUTO_TAG_TEMPLATE}
                    spellCheck={false}
                    onChange={(e) =>
                      patch(selected.id, { template: e.target.value })
                    }
                  />
                </label>
                <label className="col-span-full flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {t("autoTag.pattern")}
                  </span>
                  <input
                    className={cn(
                      MONO,
                      "h-[34px] rounded-md border bg-black/25 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      patternError
                        ? "border-error text-error"
                        : "border-border-strong text-accent2",
                    )}
                    value={selected.pattern}
                    maxLength={MAX_AUTO_TAG_PATTERN}
                    spellCheck={false}
                    aria-invalid={patternError !== ""}
                    onChange={(e) =>
                      patch(selected.id, { pattern: e.target.value })
                    }
                  />
                  {patternError && (
                    <span role="alert" className="text-xs text-error">
                      {patternError}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {t("autoTag.exclude")}
                  </span>
                  <input
                    className={cn(FIELD, MONO)}
                    value={selected.exclude}
                    placeholder="IMG, DSC"
                    maxLength={MAX_AUTO_TAG_EXCLUDE}
                    spellCheck={false}
                    onChange={(e) =>
                      patch(selected.id, { exclude: e.target.value })
                    }
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {t("autoTag.letterCase")}
                  </span>
                  <Segmented
                    label={t("autoTag.letterCase")}
                    value={selected.caseMode}
                    onChange={(caseMode) => patch(selected.id, { caseMode })}
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
                        checked={selected[key]}
                        onChange={(e) =>
                          patch(selected.id, { [key]: e.target.checked })
                        }
                      />
                      {t(label)}
                    </label>
                  ))}
                  <SmallButton
                    variant="ghost"
                    className="ml-auto h-[26px] hover:text-error"
                    onClick={() => {
                      update((c) => ({
                        ...c,
                        rules: c.rules.filter(
                          (rule) => rule.id !== selected.id,
                        ),
                      }));
                      setSelectedId(null);
                    }}
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
                      total: tested.length,
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
          )}
        </>
      </TabScroll>
    </>
  );
}
