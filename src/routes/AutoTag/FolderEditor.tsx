// Editor for one folder rule: which folder of which workspace — picked from
// the workspace's folders laid out as the tree they are — the tags everything
// under it gets, and the files that are under it now.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import type { TFunc } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  MAX_AUTO_TAG_FOLDER_TAGS,
  cleanTagName,
  isUnderFolder,
  isUsableTagName,
  type AutoTagFile,
  type FolderRule,
} from "@shared/autoTag";
import { ROOT_FOLDER, folderNameOf, parentOf } from "@shared/folderPath";
import { MAX_TAG_NAME } from "@shared/tags";
import { FIELD, MAX_ROWS, MONO, folderCountKey, folderCounts } from "./helpers";
import { Chip, MoreRows, SmallButton } from "./parts";

/** A workspace a folder rule can be for. */
export interface FolderWorkspace {
  id: string;
  label: string;
}

/** A folder of the tree: its path, what it is called, and what is under it. */
interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

/**
 * The folders of one workspace that hold files, with the folders above them,
 * as a tree under the workspace root.
 */
function folderTree(files: readonly AutoTagFile[], workspaceId: string) {
  const nodes = new Map<string, FolderNode>();
  const root: FolderNode = { path: ROOT_FOLDER, name: "", children: [] };
  nodes.set(ROOT_FOLDER, root);
  const nodeOf = (path: string): FolderNode => {
    let node = nodes.get(path);
    if (!node) {
      node = { path, name: folderNameOf(path), children: [] };
      nodes.set(path, node);
      nodeOf(parentOf(path)).children.push(node);
    }
    return node;
  };
  for (const file of files) {
    if (file.workspaceId === workspaceId) nodeOf(file.folder);
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }
  return root;
}

/** A row of the tree as drawn: the folder, how deep, and whether it is open. */
interface FolderRow {
  node: FolderNode;
  depth: number;
  open: boolean;
}

/**
 * The rows to draw: the open folders' children, top down — or, with a
 * search, every folder whose path holds the text, with the folders above it
 * so it can be seen where it is.
 */
function treeRows(
  root: FolderNode,
  expanded: ReadonlySet<string>,
  search: string,
): FolderRow[] {
  const rows: FolderRow[] = [];
  const needle = search.trim().toLowerCase();
  const shows = (node: FolderNode): boolean =>
    needle === "" ||
    node.path.toLowerCase().includes(needle) ||
    node.children.some(shows);
  const walk = (node: FolderNode, depth: number) => {
    if (!shows(node)) return;
    const open = needle !== "" || expanded.has(node.path);
    rows.push({ node, depth, open });
    if (!open) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return rows;
}

/** The folders above `path`, the root included. */
function ancestorsOf(path: string): string[] {
  const out = [ROOT_FOLDER];
  let at = path;
  while (at !== ROOT_FOLDER) {
    out.push(at);
    at = parentOf(at);
  }
  return out;
}

export function FolderEditor({
  rule,
  workspaces,
  workspaceLabel,
  files,
  existing,
  onChange,
  onDelete,
}: {
  rule: FolderRule;
  /** Every workspace; the rule's own is listed even when it is gone. */
  workspaces: readonly FolderWorkspace[];
  /** What the rule's own workspace is called. */
  workspaceLabel: string;
  files: readonly AutoTagFile[];
  /** The user's tags: lowercase → the spelling in use. */
  existing: ReadonlyMap<string, string>;
  onChange: (change: Partial<FolderRule>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [tagDraft, setTagDraft] = useState("");

  // The workspace's folders as a tree, and how many files are under each.
  const tree = useMemo(
    () => folderTree(files, rule.workspaceId),
    [files, rule.workspaceId],
  );
  const counts = useMemo(() => folderCounts(files), [files]);
  const countOf = (path: string) =>
    counts.get(folderCountKey(rule.workspaceId, path)) ?? 0;
  // Which folders are open: the ones above the rule's to begin with, so it
  // can be seen; then as the user opens and closes them.
  const [expanded, setExpanded] = useState(
    () => new Set(ancestorsOf(rule.folder)),
  );
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () => treeRows(tree, expanded, search),
    [tree, expanded, search],
  );
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const pick = (path: string) => {
    if (path !== rule.folder) onChange({ folder: path });
    // Picked while searching: what was found stays in view afterwards.
    setExpanded((prev) => new Set([...prev, ...ancestorsOf(path)]));
  };
  // Whether the rule's workspace still exists: when it does not, "no file
  // under it" would be saying less than is the case.
  const inScope = workspaces.some((w) => w.id === rule.workspaceId);

  const under = useMemo(
    () =>
      files.filter(
        (file) =>
          file.workspaceId === rule.workspaceId &&
          isUnderFolder(file.folder, rule.folder),
      ),
    [files, rule.folder, rule.workspaceId],
  );

  const addTags = () => {
    const have = new Set(rule.tags.map((tag) => tag.toLowerCase()));
    const tags = [...rule.tags];
    for (const raw of tagDraft.split(/[,、]/)) {
      const cleaned = cleanTagName(raw);
      const key = cleaned.toLowerCase();
      if (!isUsableTagName(cleaned) || have.has(key)) continue;
      if (tags.length >= MAX_AUTO_TAG_FOLDER_TAGS) break;
      have.add(key);
      // The spelling already in use, so the rule joins that tag.
      tags.push(existing.get(key) ?? cleaned);
    }
    if (tags.length !== rule.tags.length) onChange({ tags });
    setTagDraft("");
  };

  const listed = inScope
    ? workspaces
    : [...workspaces, { id: rule.workspaceId, label: workspaceLabel }];

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            {t("autoTag.folder.workspace")}
          </span>
          <Select
            value={rule.workspaceId}
            onValueChange={(workspaceId) => {
              // Another workspace has other folders: start from all of it.
              setSearch("");
              setExpanded(new Set([ROOT_FOLDER]));
              onChange({ workspaceId, folder: "" });
            }}
          >
            <SelectTrigger
              aria-label={t("autoTag.folder.workspace")}
              className="h-[30px] w-full text-[13px] text-bright-fg"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {listed.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("autoTag.folder.path")}</span>
          <div
            className={cn(
              FIELD,
              MONO,
              "flex items-center gap-2 overflow-hidden",
            )}
          >
            <Folder className="size-3.5 shrink-0 text-muted" />
            <span className="truncate">
              {rule.folder || t("autoTag.folder.root")}
            </span>
          </div>
        </div>
      </div>

      {/* The folders to pick from, as the tree they are. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted">{t("autoTag.folder.pick")}</span>
          <span className="text-xs text-muted">
            {t("autoTag.folder.pathHint")}
          </span>
        </div>
        <input
          className={cn(FIELD, MONO, "h-7")}
          value={search}
          placeholder={t("autoTag.folder.search")}
          aria-label={t("autoTag.folder.search")}
          spellCheck={false}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ScrollArea
          className="max-h-[260px] rounded-md border border-border"
          viewportClassName="max-h-[260px]"
        >
          <ul role="tree" aria-label={t("autoTag.folder.pick")} className="p-1">
            {rows.slice(0, MAX_ROWS).map(({ node, depth, open }) => (
              <FolderTreeRow
                key={node.path}
                node={node}
                depth={depth}
                open={open}
                selected={node.path === rule.folder}
                count={countOf(node.path)}
                rootLabel={t("autoTag.folder.root")}
                onToggle={() => toggle(node.path)}
                onPick={() => pick(node.path)}
                t={t}
              />
            ))}
          </ul>
          <MoreRows t={t} hidden={rows.length - MAX_ROWS} />
          {rows.length <= 1 && (
            <p className="px-2.5 pb-2 text-xs text-muted">
              {t(
                inScope
                  ? search.trim()
                    ? "autoTag.folder.noMatch"
                    : "autoTag.folder.noFolders"
                  : "autoTag.folder.outOfScope",
              )}
            </p>
          )}
        </ScrollArea>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">{t("autoTag.folder.tags")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {rule.tags.map((tag) => (
            <Chip key={tag} className="flex items-center gap-1 pr-1">
              {tag}
              <button
                type="button"
                aria-label={t("autoTag.folder.removeTag", { tag })}
                onClick={() =>
                  onChange({ tags: rule.tags.filter((x) => x !== tag) })
                }
                className="px-1 text-[13px] text-muted hover:text-bright-fg"
              >
                ×
              </button>
            </Chip>
          ))}
          {rule.tags.length < MAX_AUTO_TAG_FOLDER_TAGS && (
            <input
              className="h-6 w-44 rounded-md border border-dashed border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
              value={tagDraft}
              maxLength={MAX_TAG_NAME * 4}
              placeholder={t("autoTag.folder.addTag")}
              aria-label={t("autoTag.folder.addTag")}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                // Not while an IME is composing: that Enter only confirms the text.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) addTags();
              }}
            />
          )}
        </div>
        {rule.tags.length === 0 && (
          <span className="text-xs text-warn">
            {t("autoTag.folder.noTags")}
          </span>
        )}
      </div>

      <div className="flex justify-end">
        <SmallButton
          variant="ghost"
          className="h-[26px] hover:text-error"
          onClick={onDelete}
        >
          {t("autoTag.deleteRule")}
        </SmallButton>
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-fg">
          <span className="font-semibold">{t("autoTag.folder.files")}</span>
          <span className="text-muted">
            {t("autoTag.fileCount", { count: under.length })}
          </span>
        </div>
        <ul className="flex flex-col">
          {under.slice(0, MAX_ROWS).map((file) => (
            <li
              key={`${file.workspaceId}:${file.id}`}
              className={cn(
                MONO,
                "break-all border-b border-surface px-3 py-1.5 text-xs text-fg last:border-b-0",
              )}
            >
              {file.folder !== rule.folder && (
                <span className="text-muted">
                  {file.folder.slice(rule.folder ? rule.folder.length + 1 : 0)}/
                </span>
              )}
              {file.name}
            </li>
          ))}
        </ul>
        <MoreRows t={t} hidden={under.length - MAX_ROWS} />
        {under.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">
            {t("autoTag.folder.noFiles")}
          </p>
        )}
      </div>
    </section>
  );
}

function FolderTreeRow({
  node,
  depth,
  open,
  selected,
  count,
  rootLabel,
  onToggle,
  onPick,
  t,
}: {
  node: FolderNode;
  depth: number;
  open: boolean;
  selected: boolean;
  count: number;
  rootLabel: string;
  onToggle: () => void;
  onPick: () => void;
  t: TFunc;
}) {
  const hasChildren = node.children.length > 0;
  const label = node.path === ROOT_FOLDER ? rootLabel : node.path;
  return (
    <li
      role="treeitem"
      aria-label={label}
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      aria-level={depth + 1}
      className={cn(
        "flex items-center gap-1 rounded",
        selected ? "bg-overlay text-bright-fg" : "text-fg hover:bg-fg/5",
      )}
      style={{ paddingLeft: depth * 16 }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={t(
            open ? "autoTag.folder.collapse" : "autoTag.folder.expand",
          )}
          onClick={onToggle}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:text-bright-fg"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left text-xs"
      >
        <Folder className="size-3.5 shrink-0 text-muted" />
        <span className={cn(MONO, "truncate")}>
          {node.path === ROOT_FOLDER ? rootLabel : node.name}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-muted">
          {t("autoTag.fileCount", { count })}
        </span>
      </button>
    </li>
  );
}
