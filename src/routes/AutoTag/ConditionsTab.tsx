// Conditions tab: everything that decides which tags a file name gets. Pattern
// rules and dictionary entries sit in one list — both are conditions of the
// form "found in the name, so tag it" — and the pane beside it edits whichever
// is selected.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  MAX_AUTO_TAG_RULES,
  type KeywordEntry,
  type RuleKind,
  type TagRule,
} from "@shared/autoTag";
import { MAX_TAG_NAME } from "@shared/tags";
import {
  MAX_ROWS,
  MONO,
  keywordMatches,
  newKeyword,
  ruleDisplayName,
  ruleMatchCount,
} from "./helpers";
import { KeywordEditor } from "./KeywordEditor";
import {
  Badge,
  Chip,
  MoreRows,
  Notice,
  SmallButton,
  SplitPane,
  Toolbar,
} from "./parts";
import { RuleEditor } from "./RuleEditor";
import type { AutoTagState } from "./useAutoTag";
import { useViewState } from "./viewState";

const KIND_LABELS: Record<RuleKind, TranslationKey> = {
  prefix: "autoTag.kind.prefix",
  bracket: "autoTag.kind.bracket",
  regex: "autoTag.kind.regex",
};

const NO_NAMES: readonly string[] = [];

/** Entries past which the dictionary gets a filter box. */
const FILTER_FROM = 8;

type Selection = { kind: "rule" | "keyword"; id: string };

export function ConditionsTab({ state }: { state: AutoTagState }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { config, update, names, existing } = state;
  const [selection, setSelection] = useViewState<Selection | null>(
    "conditions.selection",
    null,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ files: number; added: number } | null>(
    null,
  );
  const [collapsed, setCollapsed] = useViewState("conditions.collapsed", false);
  const [filter, setFilter] = useViewState("conditions.filter", "");
  const [draft, setDraft] = useState("");

  // In safe mode no rule is run against the library: one of them hung the
  // screen, and it has to stay editable until it is found.
  const tested = state.safeMode ? NO_NAMES : names;

  // What is selected, falling back to the first rule (or entry) when nothing
  // is, or when the selected one was deleted.
  const selectedRule =
    selection?.kind === "rule"
      ? config.rules.find((rule) => rule.id === selection.id)
      : undefined;
  const selectedKeyword =
    selection?.kind === "keyword"
      ? config.keywords.find((entry) => entry.id === selection.id)
      : undefined;
  const shownRule =
    selectedRule ?? (selectedKeyword ? undefined : config.rules[0]);
  const shownKeyword =
    selectedKeyword ?? (shownRule ? undefined : config.keywords[0]);
  const isSelected = (kind: Selection["kind"], id: string): boolean =>
    kind === "rule" ? shownRule?.id === id : shownKeyword?.id === id;
  const select = (kind: Selection["kind"], id: string) =>
    setSelection({ kind, id });

  const patchRule = (id: string, change: Partial<TagRule>) => {
    setResult(null);
    update((c) => ({
      ...c,
      rules: c.rules.map((rule) =>
        rule.id === id ? { ...rule, ...change } : rule,
      ),
    }));
  };
  const patchKeyword = (id: string, change: Partial<KeywordEntry>) => {
    setResult(null);
    update((c) => ({
      ...c,
      keywords: c.keywords.map((k) => (k.id === id ? { ...k, ...change } : k)),
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
    select("rule", id);
  };

  // "Tag, alias, alias": the first value names the tag, the rest are aliases.
  const addKeyword = () => {
    const [tag, ...aliases] = draft.split(/[,、]/);
    const entry = newKeyword(config.keywords, tag ?? "", aliases);
    if (!entry) return;
    update((c) => ({ ...c, keywords: [...c.keywords, entry] }));
    select("keyword", entry.id);
    setDraft("");
    setFilter("");
    setCollapsed(false);
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

  // The filter only applies while its box is on screen: deleting entries can
  // take the box away, and a filter nobody can see or clear must not keep
  // hiding the list.
  const filterable = config.keywords.length > FILTER_FROM;
  const q = filterable ? filter.trim().toLowerCase() : "";
  const matching = q
    ? config.keywords.filter((entry) =>
        [entry.tag, ...entry.aliases].some((term) =>
          term.toLowerCase().includes(q),
        ),
      )
    : config.keywords;
  // The rows drawn — and the selected entry among them even when it sits past
  // the cut, so what the pane edits is always marked in the list.
  const keywords = matching.slice(0, MAX_ROWS);
  if (
    shownKeyword &&
    matching.includes(shownKeyword) &&
    !keywords.includes(shownKeyword)
  ) {
    keywords.push(shownKeyword);
  }

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
            </div>
            {config.rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg p-2",
                  isSelected("rule", rule.id)
                    ? "bg-overlay"
                    : "hover:bg-surface",
                )}
              >
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => patchRule(rule.id, { enabled })}
                  aria-label={t("autoTag.ruleEnabled")}
                />
                <button
                  type="button"
                  onClick={() => select("rule", rule.id)}
                  aria-current={isSelected("rule", rule.id)}
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

            <div className="mt-4 flex items-center gap-2 px-1 pb-2">
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => setCollapsed(!collapsed)}
                className="flex items-center gap-1 text-xs font-semibold text-fg"
              >
                {collapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                {t("autoTag.keywords")}
              </button>
              <span className="text-xs tabular-nums text-muted">
                {config.keywords.length}
              </span>
              <span className="truncate text-xs text-muted">
                {t("autoTag.keywordsHint")}
              </span>
            </div>
            {!collapsed && (
              <>
                {filterable && (
                  <input
                    className="mb-1 h-7 rounded-md border border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
                    value={filter}
                    placeholder={t("autoTag.filterKeywords")}
                    aria-label={t("autoTag.filterKeywords")}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                )}
                {keywords.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => select("keyword", entry.id)}
                    aria-current={isSelected("keyword", entry.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg p-2 text-left",
                      isSelected("keyword", entry.id)
                        ? "bg-overlay"
                        : "hover:bg-surface",
                    )}
                  >
                    <Chip className="shrink-0">{entry.tag}</Chip>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">
                      {entry.aliases.join(", ") || t("autoTag.noAliases")}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {t("autoTag.fileCount", {
                        count: keywordMatches(entry, names).length,
                      })}
                    </span>
                  </button>
                ))}
                <MoreRows t={t} hidden={matching.length - keywords.length} />
                {q !== "" && matching.length === 0 && (
                  <p className="px-2 pb-1 text-xs text-muted">
                    {t("autoTag.noKeywordsMatch")}
                  </p>
                )}
                {config.keywords.length === 0 && (
                  <p className="px-2 pb-1 text-xs text-muted">
                    {t("autoTag.noKeywords")}
                  </p>
                )}
                <input
                  className="mt-2 h-8 rounded-lg border border-dashed border-border-strong bg-transparent px-2.5 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
                  value={draft}
                  maxLength={MAX_TAG_NAME * 4}
                  placeholder={t("autoTag.addKeywordInline")}
                  aria-label={t("autoTag.addKeywordInline")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Not while an IME is composing: that Enter only confirms the text.
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      addKeyword();
                    }
                  }}
                />
              </>
            )}
          </div>
        }
      >
        {shownRule ? (
          <RuleEditor
            rule={shownRule}
            names={tested}
            onChange={(change) => patchRule(shownRule.id, change)}
            onDelete={() => {
              update((c) => ({
                ...c,
                rules: c.rules.filter((rule) => rule.id !== shownRule.id),
              }));
              setSelection(null);
            }}
          />
        ) : shownKeyword ? (
          <KeywordEditor
            // Per entry: the alias being typed belongs to the one it was typed for.
            key={shownKeyword.id}
            entry={shownKeyword}
            names={names}
            existing={existing}
            onChange={(change) => patchKeyword(shownKeyword.id, change)}
            onDelete={() => {
              update((c) => ({
                ...c,
                keywords: c.keywords.filter((k) => k.id !== shownKeyword.id),
              }));
              setSelection(null);
            }}
          />
        ) : null}
      </SplitPane>
    </>
  );
}
