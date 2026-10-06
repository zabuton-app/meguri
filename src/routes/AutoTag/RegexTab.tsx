// Regex tab: the pattern rules, in the order they run, and the pane beside
// them editing whichever is selected.
import { useConfirm } from "@/components/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  MAX_AUTO_TAG_RULES,
  builtinRulesAsShipped,
  resetBuiltinRules,
  type RuleKind,
  type TagRule,
} from "@shared/autoTag";
import { MONO, ruleDisplayName, ruleMatchCount } from "./helpers";
import { Badge, SplitPane } from "./parts";
import { RuleEditor } from "./RuleEditor";
import type { AutoTagState } from "./useAutoTag";
import { useViewState } from "./viewState";

const KIND_LABELS: Record<RuleKind, TranslationKey> = {
  prefix: "autoTag.kind.prefix",
  bracket: "autoTag.kind.bracket",
  regex: "autoTag.kind.regex",
};

const NO_NAMES: readonly string[] = [];

export function RegexTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { config, update, names } = state;
  const [selection, setSelection] = useViewState<string | null>(
    "regex.selection",
    null,
  );

  // In safe mode no rule is run against the library: one of them hung the
  // screen, and it has to stay editable until it is found.
  const tested = state.safeMode ? NO_NAMES : names;

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
          {config.rules.map((rule) => (
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
                  <span className={cn(MONO, "truncate text-[11px] text-muted")}>
                    {rule.pattern}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {t("autoTag.fileCount", {
                    count: ruleMatchCount(rule, tested),
                  })}
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
        </div>
      }
    >
      {shown && (
        <RuleEditor
          rule={shown}
          names={tested}
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
