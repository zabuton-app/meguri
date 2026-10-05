// Review tab: go through the files one by one, confirm the tags proposed for
// each, and turn a part of a file name into a rule or a dictionary entry.
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { cn } from "@/lib/utils";
import {
  MAX_AUTO_TAG_RULES,
  PREFIX_PATTERN,
  cleanTagName,
  compileKeyword,
  compileRule,
  isUsableTagName,
  proposalsFor,
  runKeyword,
  runRule,
  type Proposal,
  type RuleKind,
  type TagRule,
} from "@shared/autoTag";
import {
  BRACKET_PATTERNS,
  tokenInfo,
  tokenValues,
  tokenizeName,
  type BracketKind,
} from "@shared/autoTagAnalysis";
import { MAX_TAG_NAME } from "@shared/tags";
import { MONO, newKeyword, ruleDisplayName } from "./helpers";
import {
  Badge,
  Chip,
  MoreRows,
  Notice,
  Segmented,
  SmallButton,
  SplitPane,
  Toolbar,
} from "./parts";
import type { AutoTagSession } from "./session";
import type { AutoTagState, UndoHandle } from "./useAutoTag";

type Filter = "todo" | "done" | "all";

const BRACKET_LABELS: Record<BracketKind, TranslationKey> = {
  square: "autoTag.rule.square",
  sumi: "autoTag.rule.sumi",
  kagi: "autoTag.rule.kagi",
};

/** Rows of the file list drawn at once, as a window around the current file. */
const LIST_WINDOW = 200;

type Option =
  | {
      kind: "rule";
      title: string;
      ruleKind: RuleKind;
      ruleName: string;
      pattern: string;
      template: string;
      split: boolean;
    }
  | { kind: "keyword"; title: string; tag: string }
  | { kind: "once"; title: string; tag: string };

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function ReviewTab({
  state,
  session,
}: {
  state: AutoTagState;
  session: AutoTagSession;
}) {
  const { t } = useI18n();
  const confirmDialog = useConfirm();
  const { config, update, names, fileTags, existing, engine } = state;

  const proposals = useMemo(
    () => names.map((name) => proposalsFor(engine, name)),
    [engine, names],
  );

  const [filter, setFilter] = useState<Filter>("todo");
  const { confirmed, setConfirmed, removed, setRemoved, added, setAdded } =
    session;
  const [token, setToken] = useState<number | null>(null);
  const [choice, setChoice] = useState(0);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<{
    text: string;
    undo?: UndoHandle;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Done without the user saying so: everything proposed is already on the file.
  const settled = (i: number): boolean =>
    proposals[i].length > 0 &&
    proposals[i].every((p) => fileTags[i].has(p.key));
  const isDone = (i: number): boolean => confirmed.has(i) || settled(i);

  const finalTags = (i: number): string[] => {
    const off = removed.get(i);
    const list = proposals[i].filter((p) => !off?.has(p.key)).map((p) => p.tag);
    for (const tag of added.get(i) ?? []) {
      if (!list.some((x) => x.toLowerCase() === tag.toLowerCase())) {
        list.push(tag);
      }
    }
    return list;
  };

  const all = useMemo(() => names.map((_, i) => i), [names]);
  const doneCount = all.filter(isDone).length;
  const todoCount = all.length - doneCount;
  const visible = all.filter(
    (i) => filter === "all" || (filter === "done" ? isDone(i) : !isDone(i)),
  );

  const [rawCur, setCur] = useState(() => {
    const first = names.findIndex(
      (_, i) =>
        !(
          proposals[i].length > 0 &&
          proposals[i].every((p) => fileTags[i].has(p.key))
        ),
    );
    return Math.max(0, first);
  });
  // The list can come back shorter after a reload.
  const cur = Math.min(rawCur, Math.max(0, names.length - 1));
  const select = (i: number) => {
    setCur(i);
    setToken(null);
    setChoice(0);
    setDraft("");
  };
  const move = (delta: number) => {
    const order = visible.length > 0 ? visible : all;
    const pos = order.indexOf(cur);
    const next =
      pos < 0
        ? order[0]
        : order[Math.min(order.length - 1, Math.max(0, pos + delta))];
    if (next === undefined) return;
    // Focus would otherwise stay on whichever row was clicked last, and the
    // next Enter would be that row's click instead of "confirm".
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    select(next);
  };

  const confirm = async () => {
    if (busy || names.length === 0) return;
    const tags = finalTags(cur);
    if (tags.length > 0) {
      setBusy(true);
      const outcome = await state.apply(new Map([[cur, tags]]));
      setBusy(false);
      // Not confirmed if it was not tagged: the file stays where it is.
      if (!outcome.ok) return;
    }
    const nextConfirmed = new Set(confirmed).add(cur);
    setConfirmed(nextConfirmed);
    setNotice(null);
    const open = (i: number) => !nextConfirmed.has(i) && !settled(i);
    // "…and next" always goes somewhere. Within what the filter lists (as it
    // will read once this file counts as reviewed): the next file still to
    // review, wrapping round to an earlier one; and when none is left to
    // review — the reviewed list, or a finished library — simply the next file.
    const listed = all.filter(
      (i) => filter === "all" || (filter === "done" ? !open(i) : open(i)),
    );
    const order = listed.length > 0 ? listed : all;
    select(
      order.find((i) => i > cur && open(i)) ??
        order.find(open) ??
        order.find((i) => i > cur) ??
        all.find((i) => i > cur) ??
        cur,
    );
  };

  const confirmAll = async () => {
    const todo = all.filter((i) => !isDone(i));
    if (todo.length === 0 || busy) return;
    const ok = await confirmDialog({
      title: t("autoTag.review.confirmAllTitle"),
      message: t("autoTag.review.confirmAllMessage", { count: todo.length }),
      confirmText: t("autoTag.review.confirmAllOk"),
    });
    if (!ok) return;
    setBusy(true);
    const perFile = new Map<number, string[]>();
    for (const i of todo) {
      const tags = finalTags(i);
      if (tags.length > 0) perFile.set(i, tags);
    }
    const outcome = await state.apply(perFile);
    setBusy(false);
    if (!outcome.ok) return;
    setConfirmed(new Set([...confirmed, ...todo]));
    setNotice({
      text: t("autoTag.review.confirmedAll", {
        count: todo.length,
        added: outcome.added,
      }),
      undo: outcome.undo ?? undefined,
    });
  };

  // The list scrolls on its own, so moving with the keys has to bring the
  // current row along.
  const curRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    curRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [cur]);

  // Keys act on the current file; the handlers change every render, so the
  // listener reads them through a ref instead of re-subscribing.
  const keys = useRef({ move, confirm, token });
  useEffect(() => {
    keys.current = { move, confirm, token };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.isComposing) return;
      // Typing in a field keeps its keys, except Escape, which still closes
      // the token panel. A checkbox is not typing. Enter on a focused button
      // is that button's click.
      const typing =
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (tag === "INPUT" && (target as HTMLInputElement).type !== "checkbox");
      if (typing && e.key !== "Escape") return;
      if (tag === "BUTTON" && e.key === "Enter") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        keys.current.move(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        keys.current.move(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void keys.current.confirm();
      } else if (e.key === "Escape" && keys.current.token !== null) {
        // Consumed, so the modal underneath does not close as well.
        e.preventDefault();
        setToken(null);
      }
    };
    // Capture: the modal's own Escape listener is on window too and was
    // registered first, so in the bubble phase it would close the whole screen
    // before this could claim the key for the panel (ConfirmDialog does the
    // same for the same reason).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (names.length === 0) {
    return (
      <p className="p-8 text-center text-[13px] text-muted">
        {t("autoTag.noFiles")}
      </p>
    );
  }

  const name = names[cur] ?? "";
  const curTags = finalTags(cur);
  const curKeys = new Set(curTags.map((x) => x.toLowerCase()));
  const tokens = tokenizeName(name);
  const sourceLabel = (p: Proposal): string => {
    if (p.source.kind === "keyword") return t("autoTag.review.sourceKeyword");
    const ruleId = p.source.ruleId;
    const rule = config.rules.find((r) => r.id === ruleId);
    return t("autoTag.review.sourceRule", {
      name: rule ? ruleDisplayName(t, rule) : "",
    });
  };

  // --- the "create from token" panel -------------------------------------
  const active =
    token !== null && tokens[token] && !tokens[token].sep
      ? tokens[token]
      : null;
  const info = active ? tokenInfo(active.text) : null;
  const options: Option[] = [];
  if (info) {
    const value = cleanTagName(info.value);
    if (info.type === "code") {
      options.push({
        kind: "rule",
        title: t("autoTag.review.optCode", { code: value }),
        ruleKind: "regex",
        ruleName: t("autoTag.review.codeRuleName", { code: value }),
        pattern: `^${escapeRegExp(info.value)}-\\d+`,
        template: value,
        split: false,
      });
      options.push({
        kind: "rule",
        title: t("autoTag.review.optAllCodes"),
        ruleKind: "prefix",
        ruleName: t("autoTag.rule.prefix"),
        pattern: PREFIX_PATTERN,
        template: "$1",
        split: false,
      });
    }
    if (info.type === "bracket") {
      options.push({
        kind: "rule",
        title: t("autoTag.review.optBracket", {
          bracket: t(BRACKET_LABELS[info.bracket]),
        }),
        ruleKind: "bracket",
        ruleName: t(BRACKET_LABELS[info.bracket]),
        pattern: BRACKET_PATTERNS[info.bracket],
        template: "$1",
        split: true,
      });
    }
    if (info.type !== "code") {
      const tag = cleanTagName(info.value.split(/[,、]/)[0]);
      options.push({
        kind: "keyword",
        title: t("autoTag.review.optKeyword", { tag }),
        tag,
      });
    }
    options.push({
      kind: "once",
      title: t("autoTag.review.optOnce", { tag: value }),
      tag: value,
    });
  }
  const built = options.map((option) => {
    let hits: number[] = [cur];
    let exists = false;
    if (option.kind === "rule") {
      const rule: TagRule = {
        id: "",
        name: "",
        kind: option.ruleKind,
        pattern: option.pattern,
        template: option.template,
        exclude: "",
        ci: false,
        split: option.split,
        caseMode: "keep",
        enabled: true,
      };
      const compiled = compileRule(rule);
      hits = compiled
        ? all.filter((i) =>
            runRule(compiled, names[i]).some((hit) => hit.tags.length > 0),
          )
        : [];
      exists =
        config.rules.length >= MAX_AUTO_TAG_RULES ||
        config.rules.some(
          (r) => r.pattern === option.pattern && r.template === option.template,
        );
    } else if (option.kind === "keyword") {
      const compiled = compileKeyword({
        id: "",
        tag: option.tag,
        aliases: [],
        mode: "word",
      });
      hits = compiled
        ? all.filter((i) => runKeyword(compiled, names[i]).length > 0)
        : [];
      exists =
        !isUsableTagName(option.tag) ||
        config.keywords.some(
          (k) => k.tag.toLowerCase() === option.tag.toLowerCase(),
        );
    } else {
      exists =
        !isUsableTagName(option.tag) || curKeys.has(option.tag.toLowerCase());
    }
    return { option, hits, exists };
  });
  const chosen = built[choice];

  const create = () => {
    if (!chosen || chosen.exists) return;
    const { option, hits } = chosen;
    if (option.kind === "rule") {
      update((c) => ({
        ...c,
        rules: [
          ...c.rules,
          {
            id: crypto.randomUUID(),
            name: option.ruleName,
            kind: option.ruleKind,
            pattern: option.pattern,
            template: option.template,
            exclude: "",
            ci: false,
            split: option.split,
            caseMode: "keep",
            enabled: true,
          },
        ],
      }));
      setNotice({
        text: t("autoTag.review.ruleAdded", {
          name: option.ruleName,
          files: hits.length,
        }),
      });
    } else if (option.kind === "keyword") {
      update((c) => {
        const entry = newKeyword(c.keywords, option.tag, []);
        return entry ? { ...c, keywords: [...c.keywords, entry] } : c;
      });
      setNotice({
        text: t("autoTag.review.keywordAdded", {
          tag: option.tag,
          files: hits.length,
        }),
      });
    } else {
      setAdded(
        new Map(added).set(cur, [...(added.get(cur) ?? []), option.tag]),
      );
    }
    setToken(null);
  };

  const addDraft = () => {
    const tag = cleanTagName(draft);
    setDraft("");
    if (!isUsableTagName(tag) || curKeys.has(tag.toLowerCase())) return;
    setAdded(new Map(added).set(cur, [...(added.get(cur) ?? []), tag]));
  };

  const targetOf = (tag: string) =>
    existing.has(tag.toLowerCase())
      ? { label: t("autoTag.existingTag"), className: "text-primary" }
      : { label: t("autoTag.newTag"), className: "text-muted" };

  // --- the file list, windowed around the current file --------------------
  const pos = Math.max(0, visible.indexOf(cur));
  const start = Math.max(
    0,
    Math.min(pos - LIST_WINDOW / 2, visible.length - LIST_WINDOW),
  );
  const windowed = visible.slice(start, start + LIST_WINDOW);

  return (
    <>
      <Toolbar>
        <div className="flex min-w-[200px] flex-[1_1_240px] flex-col gap-1">
          <span className="text-xs tabular-nums text-fg">
            {t("autoTag.review.progress", {
              done: doneCount,
              total: names.length,
            })}
          </span>
          <div className="h-1 max-w-[320px] overflow-hidden rounded-sm bg-overlay">
            <div
              className="h-full bg-success"
              style={{
                width: `${Math.round((doneCount / names.length) * 100)}%`,
              }}
            />
          </div>
        </div>
        <Segmented
          tone="bg"
          label={t("autoTag.filter.label")}
          value={filter}
          onChange={setFilter}
          options={[
            {
              value: "todo",
              label: t("autoTag.review.todo"),
              count: todoCount,
            },
            {
              value: "done",
              label: t("autoTag.review.done"),
              count: doneCount,
            },
            {
              value: "all",
              label: t("autoTag.filter.all"),
              count: names.length,
            },
          ]}
        />
        <span className="whitespace-nowrap text-xs text-muted">
          {t("autoTag.review.engine", {
            rules: config.rules.filter((r) => r.enabled).length,
            keywords: config.keywords.length,
          })}
        </span>
        <SmallButton
          disabled={busy || todoCount === 0}
          onClick={() => void confirmAll()}
        >
          {t("autoTag.review.confirmAll", { count: todoCount })}
        </SmallButton>
      </Toolbar>
      {notice && (
        <Notice
          undoLabel={t("autoTag.revert")}
          onUndo={
            notice.undo
              ? () => {
                  const handle = notice.undo;
                  setNotice(null);
                  if (handle) void state.undo(handle);
                }
              : undefined
          }
        >
          {notice.text}
        </Notice>
      )}

      <SplitPane
        aside={
          <>
            <div className="flex flex-col">
              <MoreRows t={t} hidden={start} />
              {windowed.map((i) => {
                const tags = finalTags(i);
                const done = isDone(i);
                return (
                  <button
                    key={i}
                    ref={i === cur ? curRow : undefined}
                    type="button"
                    onClick={() => select(i)}
                    aria-current={i === cur}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-surface px-3 py-2 text-left",
                      i === cur ? "bg-overlay" : "hover:bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        done ? "bg-success" : "bg-border-strong",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        className={cn(
                          MONO,
                          "truncate text-xs",
                          done ? "text-muted" : "text-fg",
                        )}
                      >
                        {names[i]}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {tags.slice(0, 4).map((tag) => (
                          <Chip
                            key={tag}
                            className="px-[5px] py-px text-[11px] leading-[14px]"
                          >
                            {tag}
                          </Chip>
                        ))}
                        {tags.length > 4 && (
                          <span className="text-[11px] text-muted">
                            +{tags.length - 4}
                          </span>
                        )}
                        {tags.length === 0 && (
                          <span className="text-[11px] text-muted">
                            {t("autoTag.review.noProposals")}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
              <MoreRows
                t={t}
                hidden={visible.length - start - windowed.length}
              />
              {visible.length === 0 && (
                <p className="p-6 text-center text-xs text-muted">
                  {t("autoTag.review.noneInFilter")}
                </p>
              )}
            </div>
          </>
        }
      >
        <section className="flex min-w-0 flex-1 flex-col gap-5 px-6 py-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted">
                {cur + 1} / {names.length}
              </span>
              {isDone(cur) && (
                <span className="rounded-md border border-success px-1.5 text-[11px] text-success">
                  {t("autoTag.review.done")}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted">
                {t("autoTag.review.tokenHint")}
              </span>
            </div>
            <div
              className={cn(
                MONO,
                "flex flex-wrap items-center gap-y-1 text-[17px] leading-[30px] text-bright-fg",
              )}
            >
              {tokens.map((tk, j) => {
                if (tk.sep) {
                  return (
                    <span key={j} className="whitespace-pre text-muted">
                      {tk.text}
                    </span>
                  );
                }
                const tagged = tokenValues(tokenInfo(tk.text)).some((v) =>
                  curKeys.has(v),
                );
                const on = token === j;
                return (
                  <button
                    key={j}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setToken(on ? null : j);
                      setChoice(0);
                    }}
                    className={cn(
                      "rounded border px-1 leading-[26px] hover:border-border-strong",
                      on
                        ? "border-primary bg-primary/30"
                        : tagged
                          ? "border-transparent bg-accent2/20"
                          : "border-surface",
                    )}
                  >
                    {tk.text}
                  </button>
                );
              })}
            </div>
          </div>

          {active && info && (
            <div className="flex flex-col overflow-hidden rounded-lg border border-primary">
              <div className="flex items-center gap-2 border-b border-border bg-primary/10 px-3 py-2">
                <span className="text-xs font-semibold text-bright-fg">
                  {t("autoTag.review.panelTitle", { token: active.text })}
                </span>
                <Badge>
                  {t(
                    info.type === "bracket"
                      ? BRACKET_LABELS[info.bracket]
                      : info.type === "code"
                        ? "autoTag.review.typeCode"
                        : "autoTag.review.typeWord",
                  )}
                </Badge>
                <button
                  type="button"
                  aria-label={t("common.close")}
                  onClick={() => setToken(null)}
                  className="ml-auto text-sm text-muted hover:text-bright-fg"
                >
                  ×
                </button>
              </div>
              <div
                role="radiogroup"
                className="flex flex-col gap-1.5 px-3 py-2.5"
              >
                {built.map(({ option, hits, exists }, k) => {
                  const on = k === choice;
                  const others = hits.filter((i) => i !== cur);
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setChoice(k)}
                      className={cn(
                        "flex w-full flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left",
                        on ? "border-primary bg-primary/10" : "border-border",
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span
                          className={cn(
                            "size-3 shrink-0 rounded-full border",
                            on
                              ? "border-primary bg-primary"
                              : "border-border-strong",
                          )}
                        />
                        <span className="text-[13px] text-bright-fg">
                          {option.title}
                        </span>
                        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted">
                          {option.kind === "once"
                            ? t("autoTag.review.oneFile")
                            : t("autoTag.review.matches", {
                                count: hits.length,
                              })}
                        </span>
                      </span>
                      {option.kind === "rule" && (
                        <span
                          className={cn(
                            MONO,
                            "break-all pl-5 text-xs text-accent2",
                          )}
                        >
                          {option.pattern}{" "}
                          <span className="text-muted">
                            → {option.template}
                          </span>
                        </span>
                      )}
                      {on && others.length > 0 && (
                        <span className="flex flex-col gap-0.5 pl-5">
                          {others.slice(0, 3).map((i) => (
                            <span
                              key={i}
                              className={cn(
                                MONO,
                                "break-all text-[11px] text-fg",
                              )}
                            >
                              {names[i]}
                            </span>
                          ))}
                          {others.length > 3 && (
                            <span className="text-[11px] text-fg">
                              {t("autoTag.review.moreFiles", {
                                count: others.length - 3,
                              })}
                            </span>
                          )}
                        </span>
                      )}
                      {exists && (
                        <span className="pl-5 text-[11px] text-warn">
                          {t("autoTag.review.alreadyRegistered")}
                        </span>
                      )}
                    </button>
                  );
                })}
                <div className="flex justify-end gap-2 pt-1">
                  <SmallButton variant="ghost" onClick={() => setToken(null)}>
                    {t("common.cancel")}
                  </SmallButton>
                  <SmallButton
                    variant="primary"
                    className="px-3"
                    disabled={!chosen || chosen.exists}
                    onClick={create}
                  >
                    {t(
                      chosen?.option.kind === "rule"
                        ? "autoTag.review.createRule"
                        : chosen?.option.kind === "keyword"
                          ? "autoTag.addToDictionary"
                          : "autoTag.review.addTag",
                    )}
                  </SmallButton>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-fg">
              {t("autoTag.review.tagsToApply")}
            </span>
            <div className="flex flex-col overflow-hidden rounded-lg border border-border">
              {proposals[cur].map((p) => {
                const on = !removed.get(cur)?.has(p.key);
                const target = targetOf(p.tag);
                return (
                  <div
                    key={p.key}
                    className="flex items-center gap-2.5 border-b border-surface px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      aria-label={t("autoTag.review.applyTag", { tag: p.tag })}
                      checked={on}
                      onChange={() => {
                        const off = new Set(removed.get(cur));
                        if (!off.delete(p.key)) off.add(p.key);
                        setRemoved(new Map(removed).set(cur, off));
                      }}
                    />
                    <Chip className={cn("text-[13px]", !on && "opacity-45")}>
                      {p.tag}
                    </Chip>
                    <span className="min-w-0 truncate text-xs text-muted">
                      {sourceLabel(p)}
                    </span>
                    <span
                      className={cn(
                        "ml-auto whitespace-nowrap text-[11px]",
                        target.className,
                      )}
                    >
                      {target.label}
                    </span>
                  </div>
                );
              })}
              {(added.get(cur) ?? []).map((tag) => {
                const target = targetOf(tag);
                return (
                  <div
                    key={tag}
                    className="flex items-center gap-2.5 border-b border-surface px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      aria-label={t("autoTag.review.applyTag", { tag })}
                      checked
                      onChange={() =>
                        setAdded(
                          new Map(added).set(
                            cur,
                            (added.get(cur) ?? []).filter((x) => x !== tag),
                          ),
                        )
                      }
                    />
                    <Chip className="text-[13px]">{tag}</Chip>
                    <span className="min-w-0 truncate text-xs text-muted">
                      {t("autoTag.review.sourceManual")}
                    </span>
                    <span
                      className={cn(
                        "ml-auto whitespace-nowrap text-[11px]",
                        target.className,
                      )}
                    >
                      {target.label}
                    </span>
                  </div>
                );
              })}
              {proposals[cur].length === 0 &&
                (added.get(cur) ?? []).length === 0 && (
                  <p className="border-b border-surface p-3 text-xs text-muted">
                    {t("autoTag.review.empty")}
                  </p>
                )}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <input
                  className="h-[26px] max-w-[280px] flex-1 rounded-md border border-dashed border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
                  value={draft}
                  maxLength={MAX_TAG_NAME}
                  placeholder={t("autoTag.review.addDirect")}
                  aria-label={t("autoTag.review.addDirect")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing)
                      addDraft();
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-surface pt-3">
            <SmallButton
              className="h-[30px] border-border"
              onClick={() => move(-1)}
            >
              {t("autoTag.review.prev")}
            </SmallButton>
            <SmallButton
              className="h-[30px] border-border"
              onClick={() => move(1)}
            >
              {t("autoTag.review.skip")}
            </SmallButton>
            <span className="text-[11px] text-muted">
              {t("autoTag.review.keysHint")}
            </span>
            <SmallButton
              variant="primary"
              className="ml-auto h-[30px] px-3.5 text-[13px]"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {t(
                isDone(cur)
                  ? "autoTag.review.updateNext"
                  : "autoTag.review.confirmNext",
              )}
            </SmallButton>
          </div>
        </section>
      </SplitPane>
    </>
  );
}
