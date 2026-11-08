// Regex tab: the pattern rules, in the order they run, and the pane beside
// them editing whichever is selected.
import { useConfirm } from "@/components/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  MAX_AUTO_TAG_RULES,
  builtinRulesAsShipped,
  resetBuiltinRules,
  type RuleKind,
  type TagRule,
} from "@shared/autoTag";
import { MONO, ruleDisplayName } from "./helpers";
import { Badge, SplitPane } from "./parts";
import { RuleEditor } from "./RuleEditor";
import type { AutoTagState } from "./useAutoTag";
import type { RuleView } from "./useRuleResults";
import { useViewState } from "./viewState";

const KIND_LABELS: Record<RuleKind, TranslationKey> = {
  prefix: "autoTag.kind.prefix",
  bracket: "autoTag.kind.bracket",
  regex: "autoTag.kind.regex",
};

/** A rule's line in the list: how many files it would tag, or why not known. */
function countLabel(t: TFunc, view: RuleView): string {
  if (view.status === "done") {
    return t("autoTag.fileCount", { count: view.result.tagged });
  }
  if (view.status === "pending") {
    return view.last
      ? t("autoTag.fileCount", { count: view.last.tagged })
      : t("autoTag.ruleTesting");
  }
  return t(
    view.status === "timedOut" ? "autoTag.ruleTimedOut" : "autoTag.ruleFailed",
  );
}

export function RegexTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { config, update } = state;
  const [selection, setSelection] = useViewState<string | null>(
    "regex.selection",
    null,
  );

  // What is selected, falling back to the first rule when nothing is, or when
  // the selected one was deleted.
  const shown =
    config.rules.find((rule) => rule.id === selection) ?? config.rules[0];

  const patchRule = (id: string, change: Partial<TagRule>) =>
    update((c) => ({
      ...c,
      rules: c.rules.map((rule) =>
        rule.id === id ? { ...rule, ...change } : rule,
      ),
    }));

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
    setSelection(id);
  };

  // Nothing to reset — and nothing to ask about — while the built-in rules are
  // as they ship already.
  const builtinsAsShipped = builtinRulesAsShipped(config.rules);
  const resetRules = async () => {
    const ok = await confirm({
      title: t("autoTag.resetRules"),
      message: t("autoTag.resetRulesConfirm"),
      confirmText: t("autoTag.resetRules"),
    });
    if (!ok) return;
    update((c) => ({ ...c, rules: resetBuiltinRules(c.rules) }));
  };

  return (
    <SplitPane
      aside={
        <div className="flex flex-col gap-0.5 p-3">
          <div className="flex items-baseline gap-2 px-1 pb-2 pt-0.5">
            <span className="text-xs font-semibold text-fg">
              {t("autoTag.patternRules")}
            </span>
            <span className="text-xs text-muted">
              {t("autoTag.evaluatedInOrder")}
            </span>
            <button
              type="button"
              onClick={() => void resetRules()}
              disabled={builtinsAsShipped}
              title={t("autoTag.resetRulesHint")}
              className="ml-auto text-xs text-muted underline underline-offset-2 hover:text-bright-fg disabled:no-underline disabled:opacity-40"
            >
              {t("autoTag.resetRules")}
            </button>
          </div>
          {config.rules.map((rule) => {
            const view = state.ruleView(rule);
            return (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg p-2",
                  shown?.id === rule.id ? "bg-overlay" : "hover:bg-surface",
                )}
              >
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => patchRule(rule.id, { enabled })}
                  aria-label={t("autoTag.ruleEnabled")}
                />
                <button
                  type="button"
                  onClick={() => setSelection(rule.id)}
                  aria-current={shown?.id === rule.id}
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
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      view.status === "timedOut" || view.status === "failed"
                        ? "text-warn"
                        : "text-muted",
                    )}
                  >
                    {countLabel(t, view)}
                  </span>
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRule}
            disabled={config.rules.length >= MAX_AUTO_TAG_RULES}
            className="mt-2 h-8 rounded-lg border border-dashed border-border-strong text-xs text-muted transition hover:text-bright-fg disabled:opacity-40"
          >
            {t("autoTag.addRule")}
          </button>
        </div>
      }
    >
      {shown && (
        <RuleEditor
          rule={shown}
          names={state.names}
          view={state.ruleView(shown)}
          onChange={(change) => patchRule(shown.id, change)}
          onDelete={() => {
            update((c) => ({
              ...c,
              rules: c.rules.filter((rule) => rule.id !== shown.id),
            }));
            setSelection(null);
          }}
        />
      )}
    </SplitPane>
  );
}
