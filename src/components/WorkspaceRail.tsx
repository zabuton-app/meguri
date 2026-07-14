// Slack-style workspace (scan root) switcher rail. Shown vertically on the left
// edge: click to switch, "+" to add, the × on hover to remove from the list.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Folder,
  FolderPlus,
  HelpCircle,
  Keyboard,
  Pencil,
  Plus,
  Settings,
  Star,
  X,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import {
  restrictToVerticalAxis,
  restrictToFirstScrollableAncestor,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { api, events, ALL_ID, collectionTarget } from "@/ipc/client";
import type {
  UserCollection,
  WorkspaceInfo,
  WorkspacesList,
} from "@/ipc/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { CollectionEditDialog } from "@/components/CollectionEditDialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { openCommandMenu, openShortcuts } from "@/lib/ui-events";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import appIconUrl from "../../logo/app-256.png";

/** Never animate sortable layout changes, so items snap to their final position on drop. */
const animateLayoutChanges: AnimateLayoutChanges = () => false;

/** Builds avatar initials from a label (2 chars for alphanumerics, 1 char for Japanese, etc.). */
function initials(label: string): string {
  const s = label.trim();
  if (!s) return "?";
  const ascii = s.replace(/[^A-Za-z0-9]/g, "");
  if (ascii.length >= 2) return ascii.slice(0, 2).toUpperCase();
  return s.slice(0, 2);
}

export function WorkspaceRail() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { t } = useI18n();
  const addedWorkspaceScanJobs = useRef(new Set<string>());
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  // null = create mode; a collection = edit mode for it.
  const [editingCollection, setEditingCollection] =
    useState<UserCollection | null>(null);
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });

  // Invalidate only the queries that must be refetched on workspace change.
  // Avoid invalidating all queries (invalidateQueries()), since the chained
  // files_search refetches during a scan would stall the main process. Refresh
  // app_status first to be safe (when workspaceId changes, the files_search key
  // also changes and is refetched automatically), then explicitly invalidate
  // only the workspace list and the current search.
  const invalidateWorkspaceScoped = async () => {
    await qc.refetchQueries({ queryKey: ["app_status"] });
    await qc.invalidateQueries({ queryKey: ["workspaces_list"] });
    await qc.invalidateQueries({ queryKey: ["files_search"] });
  };

  const refreshAll = async () => {
    await invalidateWorkspaceScoped();
    if (window.location.hash !== "#/") window.location.hash = "/";
  };

  // For operations that only change the rail metadata (emoji, order) without
  // affecting the visible file set: refetch just the workspace list, so we don't
  // trigger the heavy files_search chain or yank the user back to the home route.
  const invalidateListOnly = () =>
    qc.invalidateQueries({ queryKey: ["workspaces_list"] });

  // Also track changes from other paths (e.g. the add button in the empty state).
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    void events
      .onWorkspaceChanged(() => void invalidateWorkspaceScoped())
      .then((u) => unlistens.push(u));
    void events
      .onScanDone((done) => {
        if (!addedWorkspaceScanJobs.current.has(done.jobId)) return;
        addedWorkspaceScanJobs.current.delete(done.jobId);
        toast.success(t("home.scanComplete"), {
          description: t("home.scanCompleteDetail", done.stats),
        });
      })
      .then((u) => unlistens.push(u));
    return () => unlistens.forEach((u) => u());
    // invalidateWorkspaceScoped is stable since it derives from qc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, t]);

  const add = useMutation({
    mutationFn: () => api.workspaceAdd(),
    onSuccess: (r) => {
      if (r.added) {
        toast.success(t("workspace.addedToast"));
        if (r.scanJobId) addedWorkspaceScanJobs.current.add(r.scanJobId);
        void refreshAll();
      } else {
        void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      }
    },
  });
  const switchTo = useMutation({
    mutationFn: (id: string) => api.workspaceSwitch(id),
    onSuccess: refreshAll,
  });
  const remove = useMutation({
    mutationFn: ({ id }: { id: string; label: string }) =>
      api.workspaceRemove(id),
    onSuccess: (_data, { label }) => {
      toast.success(t("workspace.removedToast"), {
        description: t("workspace.removedToastDetail", { label }),
      });
      void refreshAll();
    },
  });
  const removeCollection = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) =>
      api.collectionRemove(id),
    onSuccess: (_data, { name }) => {
      toast.success(t("collection.removedToast"), {
        description: t("collection.removedToastDetail", { name }),
      });
      void refreshAll();
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.workspaceReorder(ids),
    // The optimistic update already reflects the new order; on failure, resync
    // just the list (order changes don't affect the visible file set).
    onError: invalidateListOnly,
  });
  const reorderCollections = useMutation({
    mutationFn: (ids: string[]) => api.collectionReorder(ids),
    onError: invalidateListOnly,
  });
  const list = workspaces.data?.workspaces ?? [];
  const collections = workspaces.data?.collections ?? [];
  const allWorkspace = list.find((w) => w.id === ALL_ID);
  const realWorkspaces = list.filter((w) => w.id !== ALL_ID);
  // Only real workspaces are draggable; the virtual "All" stays pinned at the top.
  const sortableIds = realWorkspaces.map((w) => w.id);
  const collectionIds = collections.map((c) => c.id);

  // Require a small drag distance so a plain click still switches workspaces and
  // the hover × remains clickable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Collections and workspaces live in separate sortable groups; reorder only
    // within the group the dragged item belongs to (ignore cross-group drops).
    if (collectionIds.includes(activeId)) {
      const oldIndex = collectionIds.indexOf(activeId);
      const newIndex = collectionIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const nextIds = arrayMove(collectionIds, oldIndex, newIndex);
      qc.setQueryData<WorkspacesList>(["workspaces_list"], (prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.collections.map((c) => [c.id, c]));
        const reordered = nextIds
          .map((id) => byId.get(id))
          .filter((c): c is UserCollection => !!c);
        return { ...prev, collections: reordered };
      });
      reorderCollections.mutate(nextIds);
      return;
    }

    const oldIndex = sortableIds.indexOf(activeId);
    const newIndex = sortableIds.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(sortableIds, oldIndex, newIndex);

    // Optimistically reorder the cached list (keep "All" first), then persist.
    qc.setQueryData<WorkspacesList>(["workspaces_list"], (prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.workspaces.map((w) => [w.id, w]));
      const all = prev.workspaces.filter((w) => w.id === ALL_ID);
      const reordered = nextIds
        .map((id) => byId.get(id))
        .filter((w): w is WorkspaceInfo => !!w);
      return { ...prev, workspaces: [...all, ...reordered] };
    });
    reorder.mutate(nextIds);
  };

  const openCreateDialog = () => {
    setEditingCollection(null);
    setCollectionDialogOpen(true);
  };

  const openEditDialog = (collection: UserCollection) => {
    setEditingCollection(collection);
    setCollectionDialogOpen(true);
  };

  return (
    <>
      <nav className="flex h-full w-16 shrink-0 flex-col items-center gap-2 border-r border-border bg-bg py-3">
        <img src={appIconUrl} alt="Meguri" className="size-[50px] shrink-0" />

        {/* Workspace list (scrolls only here when there are many).
          Add padding so the first avatar's selection ring (ring-2) is not clipped at the top edge. */}
        <ScrollArea
          type="scroll"
          className="min-h-0 w-full flex-1"
          viewportClassName="px-1 pt-1"
        >
          <div className="flex w-full flex-col items-center gap-2 pb-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              // Keep the dragged icon on the vertical axis AND inside the scrollable
              // rail viewport, so it can't be dragged out past the top/bottom edges.
              modifiers={[
                restrictToVerticalAxis,
                restrictToFirstScrollableAncestor,
              ]}
              onDragEnd={onDragEnd}
            >
              {allWorkspace && (
                <WorkspaceButton
                  workspace={allWorkspace}
                  onClick={() => {
                    if (!allWorkspace.active) switchTo.mutate(allWorkspace.id);
                  }}
                  t={t}
                />
              )}
              <SortableContext
                items={collectionIds}
                strategy={verticalListSortingStrategy}
              >
                {collections.map((collection) => (
                  <CollectionButton
                    key={collection.id}
                    collection={collection}
                    onClick={() => {
                      if (!collection.active)
                        switchTo.mutate(collectionTarget(collection.id));
                    }}
                    onRemove={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t("collection.removeTitle"),
                          message: t("collection.removeConfirm", {
                            name: collection.name,
                          }),
                          confirmText: t("collection.removeAction"),
                          destructive: true,
                        });
                        if (ok)
                          removeCollection.mutate({
                            id: collection.id,
                            name: collection.name,
                          });
                      })();
                    }}
                    onEdit={() => openEditDialog(collection)}
                    t={t}
                  />
                ))}
              </SortableContext>
              <button
                type="button"
                onClick={openCreateDialog}
                title={t("collection.create")}
                aria-label={t("collection.create")}
                className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border text-muted transition hover:rounded-xl hover:border-primary hover:text-primary"
              >
                <FolderPlus className="size-5" />
              </button>
              {realWorkspaces.length > 0 && (
                <div className="my-1 h-px w-8 bg-border" />
              )}
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                {realWorkspaces.map((w) => (
                  <WorkspaceButton
                    key={w.id}
                    workspace={w}
                    onClick={() => {
                      if (!w.active) switchTo.mutate(w.id);
                    }}
                    onRemove={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t("workspace.removeTitle"),
                          message: t("workspace.removeConfirm", {
                            label: w.label,
                          }),
                          confirmText: t("workspace.removeAction"),
                          destructive: true,
                        });
                        if (ok) remove.mutate({ id: w.id, label: w.label });
                      })();
                    }}
                    t={t}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={() => add.mutate()}
              title={t("workspace.addDirectory")}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-dashed border-border text-muted transition hover:rounded-xl hover:border-primary hover:text-primary"
            >
              <Plus className="size-5" />
            </button>
          </div>
        </ScrollArea>

        {/* Divider between the workspace list and the pinned command menu. */}
        <div className="h-px w-8 shrink-0 bg-border" />

        {/* App actions (pinned at the bottom) */}
        <button
          type="button"
          onClick={openCommandMenu}
          title={`${t("command.title")} (Ctrl+K)`}
          aria-label={t("command.title")}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted transition hover:rounded-xl hover:bg-overlay hover:text-fg"
        >
          <Keyboard className="size-5" />
        </button>
        <button
          type="button"
          onClick={openShortcuts}
          title={`${t("shortcuts.title")} (?)`}
          aria-label={t("shortcuts.title")}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted transition hover:rounded-xl hover:bg-overlay hover:text-fg"
        >
          <HelpCircle className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.hash = "/settings";
          }}
          title={t("workspace.settings")}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted transition hover:rounded-xl hover:bg-overlay hover:text-fg"
        >
          <Settings className="size-5" />
        </button>
      </nav>

      <CollectionEditDialog
        open={collectionDialogOpen}
        onOpenChange={setCollectionDialogOpen}
        collection={editingCollection}
        onCreated={() => void refreshAll()}
      />
    </>
  );
}

function CollectionButton({
  collection,
  onClick,
  onRemove,
  onEdit,
  t,
}: {
  collection: UserCollection;
  onClick: () => void;
  onRemove: () => void;
  onEdit: () => void;
  t: TFunc;
}) {
  const sortable = useSortable({ id: collection.id, animateLayoutChanges });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 1 : undefined,
  };
  // The setNodeRef / attributes / listeners / isDragging that dnd-kit's useSortable returns
  // are meant to be applied during render. Replacing them with state/props breaks DnD, so
  // react-hooks/refs is suppressed here as a library requirement.
  return (
    <div
      // eslint-disable-next-line react-hooks/refs
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "group relative shrink-0",
        // eslint-disable-next-line react-hooks/refs
        sortable.isDragging && "opacity-60",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            title={`${collection.name} (${collection.items.length})`}
            aria-label={collection.name}
            // eslint-disable-next-line react-hooks/refs
            {...sortable.attributes}
            // eslint-disable-next-line react-hooks/refs
            {...sortable.listeners}
            className={cn(
              "flex size-11 touch-none items-center justify-center text-sm font-semibold transition",
              collection.active
                ? "rounded-xl bg-primary text-primary-foreground ring-2 ring-fg/40"
                : "rounded-2xl bg-surface text-fg hover:rounded-xl hover:bg-overlay",
            )}
          >
            {collection.emoji ? (
              <span className="text-xl leading-none">{collection.emoji}</span>
            ) : (
              <Folder
                className={cn("size-5", collection.active && "fill-current")}
              />
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              // Open the edit dialog only after the context menu has finished
              // closing. Opening it synchronously from onSelect lets the menu's
              // teardown leave `pointer-events: none` stuck on <body>, freezing
              // the window. (EmojiPicker dodges this via its own close guard.)
              setTimeout(onEdit, 0);
            }}
          >
            <Pencil />
            {t("collection.edit")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <button
        type="button"
        onClick={onRemove}
        title={t("collection.removeFromSidebar")}
        className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-error text-bg group-hover:flex"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}

function WorkspaceButton({
  workspace,
  onClick,
  onRemove,
  t,
}: {
  workspace: WorkspaceInfo;
  onClick: () => void;
  onRemove?: () => void;
  t: TFunc;
}) {
  const isAll = workspace.id === ALL_ID;
  // "All" is pinned (not registered as a sortable item), so disable dragging for it.
  // Disable drop layout animation: the optimistic cache reorder already moves the
  // item to its final slot, so animating the layout change makes it jump on drop.
  const sortable = useSortable({
    id: workspace.id,
    disabled: isAll,
    animateLayoutChanges,
  });
  const style = isAll
    ? undefined
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        zIndex: sortable.isDragging ? 1 : undefined,
      };
  const button = (
    <button
      type="button"
      onClick={onClick}
      title={isAll ? t("workspace.all") : workspace.path}
      aria-label={isAll ? t("workspace.all") : workspace.label}
      {...(isAll ? {} : sortable.attributes)}
      {...(isAll ? {} : sortable.listeners)}
      className={cn(
        "flex size-11 items-center justify-center text-sm font-semibold transition",
        !isAll && "touch-none",
        workspace.active
          ? "rounded-xl bg-primary text-primary-foreground ring-2 ring-fg/40"
          : "rounded-2xl bg-surface text-fg hover:rounded-xl hover:bg-overlay",
      )}
    >
      {isAll ? (
        <Star className={cn("size-5", workspace.active && "fill-current")} />
      ) : workspace.emoji ? (
        <span className="text-xl leading-none">{workspace.emoji}</span>
      ) : (
        initials(workspace.label)
      )}
    </button>
  );
  return (
    <div
      ref={isAll ? undefined : sortable.setNodeRef}
      style={style}
      className={cn(
        "group relative shrink-0",
        sortable.isDragging && "opacity-60",
      )}
    >
      {button}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("workspace.removeFromSidebar")}
          className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-error text-bg group-hover:flex"
        >
          <X className="size-2.5" />
        </button>
      )}
    </div>
  );
}
