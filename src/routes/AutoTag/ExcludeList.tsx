// A rule's excluded values as a list: one field to add (or find) a value, and
// each value on a row of its own with a way to remove it. The list is meant to
// be kept for a long time and can run to thousands of values, so it scrolls
// in a box of its own and is searched from the same field it is added to from.
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TFunc } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  MAX_AUTO_TAG_EXCLUDE,
  excludeValues,
  formatExclude,
} from "@shared/autoTag";
import { FIELD, MAX_ROWS, MONO } from "./helpers";
import { MoreRows, SmallButton } from "./parts";

export function ExcludeList({
  exclude,
  onChange,
  t,
}: {
  /** The list as stored: one value to a line (see formatExclude). */
  exclude: string;
  onChange: (exclude: string) => void;
  t: TFunc;
}) {
  const [draft, setDraft] = useState("");
  const values = excludeValues(exclude);

  // What adding the draft would come to. Several values can be given at once
  // (pasted a line each, or with commas); ones already listed add nothing.
  const merged = excludeValues(formatExclude([...values, draft]));
  const next = formatExclude(merged);
  const adds = merged.length - values.length;
  const full = next.length > MAX_AUTO_TAG_EXCLUDE;
  const add = () => {
    if (adds === 0 || full) return;
    onChange(next);
    setDraft("");
  };

  // The same field finds a value: what is typed narrows the list, so one out
  // of thousands can be reached to be removed.
  const needle = draft.trim().toLowerCase();
  const shown = needle
    ? values.filter((value) => value.toLowerCase().includes(needle))
    : values;

  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-xs text-muted">
        {t("autoTag.exclude")}
        <span className="tabular-nums">
          {t("autoTag.excludeCount", { count: values.length })}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <input
          className={cn(FIELD, MONO, "min-w-0 flex-1")}
          value={draft}
          placeholder={t("autoTag.excludeAdd")}
          aria-label={t("autoTag.excludeAdd")}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          // A list pasted a value to a line: a one-line field would run the
          // lines together, so they are kept apart as commas instead.
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!/[\n\r]/.test(text)) return;
            e.preventDefault();
            const pasted = excludeValues(text).join(", ");
            setDraft((prev) => (prev.trim() ? `${prev}, ${pasted}` : pasted));
          }}
          onKeyDown={(e) => {
            // Not while an IME is composing: that Enter only confirms the text.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
          }}
        />
        <SmallButton
          className="h-[30px]"
          disabled={adds === 0 || full}
          title={full ? t("autoTag.excludeFull") : undefined}
          onClick={add}
        >
          {t("autoTag.excludeAddButton")}
        </SmallButton>
      </div>
      {full && adds > 0 && (
        <span role="alert" className="text-xs text-warn">
          {t("autoTag.excludeFull")}
        </span>
      )}
      <ScrollArea
        className="max-h-[188px] rounded-md border border-border"
        viewportClassName="max-h-[188px]"
      >
        <ul className="flex flex-col">
          {shown.slice(0, MAX_ROWS).map((value) => (
            <li
              key={value}
              className="flex items-center gap-2 border-b border-surface px-2.5 py-1 last:border-b-0"
            >
              <span
                className={cn(
                  MONO,
                  "min-w-0 flex-1 truncate text-[13px] text-bright-fg",
                )}
              >
                {value}
              </span>
              <button
                type="button"
                aria-label={t("autoTag.excludeRemove", { value })}
                onClick={() =>
                  onChange(formatExclude(values.filter((v) => v !== value)))
                }
                className="shrink-0 rounded px-1.5 text-xs text-muted transition hover:bg-fg/10 hover:text-bright-fg"
              >
                {t("autoTag.excludeRemoveButton")}
              </button>
            </li>
          ))}
        </ul>
        <MoreRows t={t} hidden={shown.length - MAX_ROWS} />
        {shown.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-muted">
            {t(needle ? "autoTag.excludeNoMatch" : "autoTag.excludeNone")}
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
