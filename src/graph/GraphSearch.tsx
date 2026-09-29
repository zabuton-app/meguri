// The graph's own search: type part of a file or tag name, pick a candidate,
// and the view moves to that node and selects it. It is also the keyboard's
// way to open a node, which the canvas offers only to the pointer: Shift+Enter
// opens the candidate, and Enter with nothing typed opens the selected node.
import { useId, useMemo, useState, type KeyboardEvent, type Ref } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { searchNodes } from "./model/search";
import type { MediaGraph } from "./model/types";
import type { Visibility } from "./model/visibility";
import { NodeDot } from "./NodeDot";

interface Props {
  graph: MediaGraph;
  visibility: Visibility;
  /** The node picked last, which Enter on an empty search opens. */
  selected: string | null;
  onPick: (key: string) => void;
  /** Open a node as a click on it does. */
  onOpen: (key: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export function GraphSearch({
  graph,
  visibility,
  selected,
  onPick,
  onOpen,
  inputRef,
}: Props) {
  const { t } = useI18n();
  const listId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(
    () => searchNodes(graph, text, visibility.nodes, visibility.degree),
    [graph, text, visibility],
  );
  const showList = open && text.trim() !== "";

  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.max(0, Math.min(hits.length - 1, i + 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      // Not while an IME is composing: that Enter only confirms the text.
      const hit = hits[active];
      if (text.trim() === "") {
        // A pick the toggles have since hidden stays selected, but is not
        // there to open.
        if (selected && visibility.nodes.has(selected)) {
          e.preventDefault();
          onOpen(selected);
        }
      } else if (hit) {
        e.preventDefault();
        pick(hit.key);
        if (e.shiftKey) onOpen(hit.key);
      }
    } else if (e.key === "Escape" && showList) {
      // Close the list first; the next Esc reaches the view.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative w-64">
      {/* Outside the label, whose text is the input's name. */}
      <span id={hintId} className="sr-only">
        {t("graph.search.hint")}
      </span>
      <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0" />
        <span className="sr-only">{t("graph.search.label")}</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-describedby={hintId}
          aria-activedescendant={
            showList && hits[active] ? `${listId}-${active}` : undefined
          }
          value={text}
          placeholder={t("graph.search.placeholder")}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
        />
      </label>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-9 z-20 max-h-80 w-80 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {hits.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-muted">
              {t("graph.search.noMatch")}
            </li>
          ) : (
            hits.map((hit, i) => {
              const attrs = graph.getNodeAttributes(hit.key);
              return (
                <li
                  key={hit.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown, not click: the input's blur would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(hit.key);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-2 rounded px-2.5 text-sm text-fg",
                    i === active && "bg-fg/10",
                  )}
                >
                  <NodeDot node={attrs} />
                  <span className="truncate">{hit.label}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
