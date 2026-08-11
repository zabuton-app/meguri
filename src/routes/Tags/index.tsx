// Tag management. /tags. Lists every tag in the current scope with its file count
// and origin, and lets the user rename, merge and delete the ones they created.
// Overlays the library as a modal, like /duplicates and /history.
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Maximize2,
  Minimize2,
  Tags as TagsIcon,
  X,
} from "lucide-react";
import { MAX_TAG_LIST, tagSearchToken } from "@shared/tags";
import type { TagRef, TagSummary } from "@/ipc/types";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useConfirm } from "@/components/ConfirmDialog";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";
import { HistoryModal } from "@/routes/History/HistoryModal";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { invalidateTagCatalog } from "@/lib/queryCache";
import { applyTagFilter } from "@/lib/ui-events";
import { tagHumanLabel, tagNamespaceLabel } from "@/lib/tagLabel";
import { useI18n } from "@/i18n/I18nProvider";
import { TagRow } from "./TagRow";
import { TagRenameDialog } from "./TagRenameDialog";
import { TagMergeDialog } from "./TagMergeDialog";
import {
  filterTags,
  groupTagsByNamespace,
  isTagSort,
  sortTags,
  type TagSort,
} from "./utils";

const MODAL_SIZE_KEY = "meguri.tags.modalSize";
const SORT_KEY = "meguri.tags.sort";

const refOf = (tag: TagSummary): TagRef => ({
  namespace: tag.namespace,
  name: tag.name,
});

export default function Tags() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const onClose = useCallback(() => {
    void navigate("/");
  }, [navigate]);

  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "small",
    (raw) => (raw === "large" ? "large" : "small"),
  );
  const toggleModalSize = useCallback(
    () => setModalSize((prev) => (prev === "small" ? "large" : "small")),
    [setModalSize],
  );
  const [sort, setSort] = useLocalStorage<TagSort>(SORT_KEY, "count", (raw) =>
    isTagSort(raw) ? raw : "count",
  );

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // In-memory only: useLocalStorage stores primitives, and a collapsed-group set
  // is not worth a bespoke hook.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<TagSummary | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const status = useAppStatus();
  const ready = status.data?.ready ?? false;
  const wsId = status.data?.workspaceId ?? "";

  const catalog = useQuery({
    queryKey: ["tags_list_all", wsId],
    queryFn: api.tagsListAll,
    enabled: ready,
  });
  const all = useMemo(() => catalog.data?.tags ?? [], [catalog.data]);

  const label = useCallback(
    (tag: TagSummary) => tagHumanLabel(t, tag.namespace, tag.name),
    [t],
  );
  const groups = useMemo(
    () => groupTagsByNamespace(sortTags(filterTags(all, search, label), sort)),
    [all, search, sort, label],
  );
  // Sum of per-tag counts, i.e. assignments — a file with four generated tags
  // contributes four. The label says "assignments" for that reason; a true file
  // total would need another round trip for a number nobody asked for.
  const totalAssignments = useMemo(
    () => all.reduce((sum, tag) => sum + tag.fileCount, 0),
    [all],
  );
  const existingNames = useMemo(
    () =>
      new Set(all.filter((tag) => !tag.pipelineOwned).map((tag) => tag.name)),
    [all],
  );
  const selectedTags = useMemo(
    () => all.filter((tag) => selected.has(tag.qualified)),
    [all, selected],
  );

  const afterMutation = useCallback(() => {
    setSelected(new Set());
    invalidateTagCatalog(qc);
  }, [qc]);

  const renameTag = useMutation({
    mutationFn: ({ from, to }: { from: TagRef; to: string }) =>
      api.tagRename(from, to),
    onSuccess: (res, vars) => {
      afterMutation();
      // main escalates to a merge when the target name already exists — which the
      // renderer cannot always predict, since its catalog may be truncated.
      toast.success(
        res.merged
          ? t("tags.merged", { count: 1 })
          : t("tags.renamed", { from: vars.from.name, to: vars.to }),
      );
    },
    onError: (error) =>
      toast.error(t("tags.renameFailed"), {
        description: error instanceof Error ? error.message : String(error),
      }),
  });
  const mergeTags = useMutation({
    mutationFn: ({ from, into }: { from: TagRef[]; into: TagRef }) =>
      api.tagMerge(from, into),
    onSuccess: (_res, vars) => {
      afterMutation();
      toast.success(t("tags.merged", { count: vars.from.length }));
    },
    onError: (error) =>
      toast.error(t("tags.mergeFailed"), {
        description: error instanceof Error ? error.message : String(error),
      }),
  });
  const deleteTags = useMutation({
    mutationFn: (refs: TagRef[]) => api.tagDelete(refs),
    onSuccess: () => {
      afterMutation();
      toast.success(t("tags.deleted"));
    },
    onError: (error) =>
      toast.error(t("tags.deleteFailed"), {
        description: error instanceof Error ? error.message : String(error),
      }),
  });

  const toggleSelect = useCallback((tag: TagSummary) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag.qualified)) next.delete(tag.qualified);
      else next.add(tag.qualified);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((namespace: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) next.delete(namespace);
      else next.add(namespace);
      return next;
    });
  }, []);

  const onFilterByTag = useCallback(
    (tag: TagSummary) => {
      applyTagFilter([tagSearchToken(tag.name)]);
      void navigate("/");
    },
    [navigate],
  );

  const onDeleteOne = useCallback(
    async (tag: TagSummary) => {
      const ok = await confirm({
        title: t("tags.delete"),
        message: t("tags.deleteConfirm", {
          name: tag.qualified,
          count: tag.fileCount,
        }),
        confirmText: t("tags.deleteAction"),
        destructive: true,
      });
      if (ok) deleteTags.mutate([refOf(tag)]);
    },
    [confirm, deleteTags, t],
  );

  const onDeleteSelected = useCallback(async () => {
    const ok = await confirm({
      title: t("tags.delete"),
      message: t("tags.deleteConfirmMany", { count: selectedTags.length }),
      confirmText: t("tags.deleteAction"),
      destructive: true,
    });
    if (ok) deleteTags.mutate(selectedTags.map(refOf));
  }, [confirm, deleteTags, selectedTags, t]);

  const onRenameConfirmed = useCallback(
    (tag: TagSummary, newName: string) =>
      renameTag.mutate({ from: refOf(tag), to: newName }),
    [renameTag],
  );

  const onRenameCollision = useCallback(
    async (tag: TagSummary, targetName: string) => {
      const ok = await confirm({
        title: t("tags.renameTitle"),
        message: t("tags.renameConflict", { name: targetName }),
        confirmText: t("tags.mergeAction"),
      });
      if (ok) {
        mergeTags.mutate({
          from: [refOf(tag)],
          into: { namespace: "", name: targetName },
        });
      }
    },
    [confirm, mergeTags, t],
  );

  const mutating =
    renameTag.isPending || mergeTags.isPending || deleteTags.isPending;
  const loading = ready && catalog.isLoading;
  const isSmall = modalSize === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");

  return (
    <HistoryModal onClose={onClose} size={modalSize}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <TagsIcon className="size-4 text-primary" />
        <span className="text-sm font-medium text-fg">{t("tags.title")}</span>
        {all.length > 0 && (
          <span className="text-xs text-muted">
            {t("tags.summary", {
              tags: all.length,
              assignments: totalAssignments,
            })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("tags.searchPlaceholder")}
            aria-label={t("tags.searchPlaceholder")}
            className="h-7 w-40 text-xs"
          />
          <ButtonGroup>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSort("name")}
              aria-pressed={sort === "name"}
            >
              {t("tags.sortByName")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSort("count")}
              aria-pressed={sort === "count"}
            >
              {t("tags.sortByCount")}
            </Button>
          </ButtonGroup>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={toggleModalSize}
            aria-label={toggleLabel}
            aria-pressed={isSmall}
            title={toggleLabel}
          >
            {isSmall ? <Maximize2 /> : <Minimize2 />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onClose}
            aria-label={t("common.close")}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </header>

      {selectedTags.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
          <span className="text-xs text-fg">
            {t("tags.selected", { count: selectedTags.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={selectedTags.length < 2 || mutating}
            onClick={() => setMergeOpen(true)}
          >
            {t("tags.merge")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={mutating}
            onClick={() => void onDeleteSelected()}
          >
            {t("tags.delete")}
          </Button>
          <button
            type="button"
            className="ml-auto text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
            onClick={() => setSelected(new Set())}
          >
            {t("tags.clearSelection")}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full rounded-lg" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <TagsIcon className="size-10 opacity-50" />
            <p>{t("tags.empty")}</p>
            <p className="text-xs">{t("tags.emptyHint")}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-muted">
            <p>{t("tags.noMatch")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {catalog.data?.truncated && (
              <p className="px-1 text-xs text-muted">
                {t("tags.truncated", { max: MAX_TAG_LIST })}
              </p>
            )}
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.namespace);
              const pipelineOwned = group.namespace !== "";
              return (
                <section key={group.namespace || "manual"}>
                  <h3 className="sticky top-0 z-10 flex items-baseline gap-2 bg-bg px-1 py-1.5 text-xs font-semibold text-muted">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-fg"
                      onClick={() => toggleGroup(group.namespace)}
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                      {pipelineOwned && <Lock className="size-3" />}
                      {pipelineOwned
                        ? tagNamespaceLabel(t, group.namespace)
                        : t("tags.groupManual")}
                    </button>
                    <span className="tabular-nums">{group.tags.length}</span>
                    {pipelineOwned && (
                      <span className="font-normal opacity-70">
                        {t("tags.readOnly")}
                      </span>
                    )}
                  </h3>
                  {pipelineOwned && !isCollapsed && (
                    <p className="px-1 pb-1 text-xs text-muted">
                      {t("tags.readOnlyHint")}
                    </p>
                  )}
                  {!isCollapsed && (
                    <ul className="flex flex-col">
                      {group.tags.map((tag) => (
                        <TagRow
                          key={tag.qualified}
                          tag={tag}
                          selected={selected.has(tag.qualified)}
                          busy={mutating}
                          onToggleSelect={toggleSelect}
                          onFilter={onFilterByTag}
                          onRename={setRenameTarget}
                          onDelete={(target) => void onDeleteOne(target)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <TagRenameDialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        tag={renameTarget}
        existingNames={existingNames}
        onRename={onRenameConfirmed}
        onMerge={(tag, targetName) => void onRenameCollision(tag, targetName)}
      />
      <TagMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        tags={selectedTags}
        onMerge={(sources, into) =>
          mergeTags.mutate({ from: sources.map(refOf), into: refOf(into) })
        }
      />
    </HistoryModal>
  );
}
