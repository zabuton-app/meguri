import { useMemo } from "react";
import { Check, Plus } from "lucide-react";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { nameTagParts } from "@shared/autoTagAnalysis";
import { isEditableTag } from "@shared/tags";

/**
 * How a part is matched against the tags the file has: ASCII case aside, as a
 * tag search matches (see tagSearchKey) — `trip` on the file answers for
 * `Trip` in its name, while `Été` and `été` stay two tags, as they are stored.
 */
const foldCase = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The file's name, cut into the parts that could be tags: each word, a code's
 * prefix, each entry inside brackets. Clicking a part tags the file with it —
 * the name usually says what the file is, and this saves typing it again.
 */
export function NameTags({
  basename,
  tags,
  onAdd,
  t,
}: {
  /** The file's name without its folders, extension included. */
  basename: string;
  tags: FileDetail["tags"];
  onAdd: (tag: string) => void;
  t: TFunc;
}) {
  const parts = useMemo(() => nameTagParts(basename), [basename]);
  const have = useMemo(
    () =>
      new Set(
        tags
          .filter((tag) => isEditableTag(tag.namespace))
          .map((tag) => foldCase(tag.name)),
      ),
    [tags],
  );
  if (!parts.some((part) => part.tag !== null)) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted">{t("media.nameTags.hint")}</span>
      <div className="flex flex-wrap items-center gap-y-1 font-mono text-sm leading-7 text-bright-fg">
        {parts.map((part, i) => {
          const { tag } = part;
          if (tag === null) {
            return (
              <span key={i} className="whitespace-pre text-muted">
                {part.text}
              </span>
            );
          }
          const tagged = have.has(foldCase(tag));
          const label = t(
            tagged ? "media.nameTags.tagged" : "media.nameTags.add",
            { tag },
          );
          return (
            <button
              key={i}
              type="button"
              disabled={tagged}
              aria-label={label}
              title={label}
              onClick={() => onAdd(tag)}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tagged
                  ? "border-transparent bg-accent2/20"
                  : "border-dashed border-border-strong hover:border-solid hover:bg-overlay",
              )}
            >
              {tagged ? (
                <Check className="size-3 text-success" aria-hidden="true" />
              ) : (
                <Plus className="size-3 text-muted" aria-hidden="true" />
              )}
              {part.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
