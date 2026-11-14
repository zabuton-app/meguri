// Slack-style workspace (scan root) switcher rail. Shown vertically on the left
// edge: click to switch, "+" to add, the × on hover to remove from the list.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Clock,
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
import type { WorkspaceAddResult } from "@shared/ipc/channels";
import { useConfirm } from "@/components/ConfirmDialog";
import { CollectionEditDialog } from "@/components/CollectionEditDialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import { cn } from "@/lib/utils";
import { invalidateWorkspaceScoped } from "@/lib/workspaceScope";
import { openCommandMenu, openShortcuts } from "@/lib/ui-events";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import { useLogo, useLogoImages } from "@/hooks/useLogo";
import { useFileDropTarget } from "@/hooks/useFileDropTarget";
import { useOsFolderDrop, type DroppedItems } from "@/hooks/useOsFolderDrop";
import { useAddFilesToCollection } from "@/hooks/useAddFilesToCollection";
import type { DraggedFile } from "@/lib/fileDrag";
import { appName } from "@/lib/appName";

/** Never animate sortable layout changes, so items snap to their final position on drop. */
const animateLayoutChanges: AnimateLayoutChanges = () => false;

/**
 * Highlight of a collection while files are dragged over it. The ring is the
 * signal and shows for everyone; only the grow is motion, so reduced-motion
 * users get the same highlight without it.
 */
const DROP_OVER =
  "rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-bg motion-safe:scale-110 motion-reduce:transition-none";

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
  // In-app logo mark follows the selected variant (Settings > App logo).
  const { logo } = useLogo();
  const logoImages = useLogoImages();
  const addedWorkspaceScanJobs = useRef(new Set<string>());
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  // null = create mode; a collection = edit mode for it.
  const [editingCollection, setEditingCollection] =
    useState<UserCollection | null>(null);
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });

  const refreshAll = async () => {
    await invalidateWorkspaceScoped(qc);
    if (window.location.hash !== "#/") window.location.hash = "/";
  };

  // For operations that only change the rail metadata (emoji, order) without
  // affecting the visible file set: refetch just the workspace list, so we don't
  // trigger the heavy files_search chain or yank the user back to the home route.
  const invalidateListOnly = () =>
    qc.invalidateQueries({ queryKey: ["workspaces_list"] });

  // Also track changes from other paths (e.g. the add button in the empty state).
  useEffect(() => {
    const unlistens = [
      events.onWorkspaceChanged(() => void invalidateWorkspaceScoped(qc)),
      events.onScanDone((done) => {
        if (!addedWorkspaceScanJobs.current.has(done.jobId)) return;
        addedWorkspaceScanJobs.current.delete(done.jobId);
        // A failed or canceled scan is told about by Home (#313).
        if (done.error || done.aborted) return;
        toast.success(t("home.scanComplete"), {
          description: t("home.scanCompleteDetail", done.stats),
        });
      }),
    ];
    return () => unlistens.forEach((u) => u());
  }, [qc, t]);

  // What registering a folder did, however it was chosen: the picker or a
  // drop from the OS.
  const onAdded = (r: WorkspaceAddResult) => {
    if (r.added) {
      if (r.existing) toast.info(t("workspace.alreadyAddedToast"));
      else toast.success(t("workspace.addedToast"));
      if (r.scanJobId) addedWorkspaceScanJobs.current.add(r.scanJobId);
      void refreshAll();
    } else {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
    }
  };
  const addViaPicker = useMutation({
    mutationFn: () => api.workspaceAdd(),
    onSuccess: onAdded,
  });
  const addDropped = useMutation({
    mutationFn: (dir: File) => api.workspaceAddDropped(dir),
    onSuccess: (r, dir) => {
      if (r.notDirectory) {
        toast.error(t("drop.notDirectory", { name: dir.name }));
      }
      onAdded(r);
    },
    meta: { reportsOwnError: true },
    onError: (e, dir) =>
      toast.error(t("drop.addFailed", { name: dir.name }), {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  // Dropped folders are confirmed and registered one at a time, so every
  // confirm names its folder. A drop that lands while a confirm is still open
  // joins the same queue rather than starting a second loop: the confirm
  // dialog shows one prompt at a time.
  const dropQueue = useRef<File[]>([]);
  const draining = useRef(false);
  const drainDropQueue = async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      for (let dir; (dir = dropQueue.current.shift());) {
        const ok = await confirm({
          title: t("drop.addTitle"),
          message: t("drop.addConfirm", { name: dir.name }),
          confirmText: t("drop.addAction"),
        });
        // Failures are reported by addDropped's onError; carry on with the rest.
        if (ok) await addDropped.mutateAsync(dir).catch(() => {});
      }
    } finally {
      draining.current = false;
    }
  };
  const { active: osDragActive } = useOsFolderDrop(
    ({ dirs, others }: DroppedItems) => {
      if (others > 0) toast.info(t("drop.foldersOnly"));
      dropQueue.current.push(...dirs);
      void drainDropQueue();
    },
  );

  const dropOnto = useAddFilesToCollection();
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
  const allCollections = workspaces.data?.collections ?? [];
  // Built-in "Watch Later" is pinned right below "All" and never takes part in
  // reordering; only user-created collections are draggable. Matched by ID, not
  // by the generic `locked` flag, so it stays the one entry rendered here even
  // if other locked collections ever exist.
  const watchLater = allCollections.find((c) => c.id === WATCH_LATER_ID);
  const collections = allCollections.filter((c) => c.id !== WATCH_LATER_ID);
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
        // Watch Later isn't part of `nextIds`; keep it pinned in front instead
        // of dropping it from the cache.
        const pinned = prev.collections.filter((c) => c.id === WATCH_LATER_ID);
        return { ...prev, collections: [...pinned, ...reordered] };
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
      <nav
        data-slot="workspace-rail"
        className="flex h-full w-16 shrink-0 flex-col items-center gap-2 border-r border-border bg-bg py-3"
      >
        {/* The bitmaps arrive from main just after the first paint; hold the
          space meanwhile, without an <img> that would show its alt text. */}
        {logoImages ? (
          <img
            src={logoImages[logo]}
            alt={appName()}
            className="size-[50px] shrink-0"
          />
        ) : (
          <div className="size-[50px] shrink-0" />
        )}

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
              {watchLater && (
                <WatchLaterButton
                  collection={watchLater}
                  onClick={() => {
                    if (!watchLater.active)
                      switchTo.mutate(collectionTarget(watchLater.id));
                  }}
                  onDropFiles={dropOnto(watchLater.id, t("watchLater.name"))}
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
                    onDropFiles={dropOnto(collection.id, collection.name)}
                    t={t}
                  />
                ))}
              </SortableContext>
              <button
                type="button"
                onClick={openCreateDialog}
                data-tour="collections"
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
              onClick={() => addViaPicker.mutate()}
              data-tour="add-workspace"
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
          data-tour="command-menu"
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
          data-tour="settings"
          title={t("workspace.settings")}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted transition hover:rounded-xl hover:bg-overlay hover:text-fg"
        >
          <Settings className="size-5" />
        </button>
      </nav>

      {osDragActive && <FolderDropOverlay t={t} />}

      <CollectionEditDialog
        open={collectionDialogOpen}
        onOpenChange={setCollectionDialogOpen}
        collection={editingCollection}
        onCreated={() => void refreshAll()}
      />
    </>
  );
}

/**
 * The built-in "Watch Later" collection. Deliberately not a `CollectionButton`:
 * it is not sortable and carries none of the remove/edit affordances, since it
 * cannot be deleted, renamed, reordered, or re-iconed. Its label comes from i18n
 * rather than the stored name so it follows the UI language.
 */
function WatchLaterButton({
  collection,
  onClick,
  onDropFiles,
  t,
}: {
  collection: UserCollection;
  onClick: () => void;
  onDropFiles: (files: DraggedFile[]) => void;
  t: TFunc;
}) {
  const label = t("watchLater.name");
  const drop = useFileDropTarget(onDropFiles);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${collection.items.length})`}
      aria-label={label}
      {...drop.handlers}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center text-sm font-semibold transition",
        collection.active
          ? "rounded-xl bg-primary text-primary-foreground ring-2 ring-fg/40"
          : "rounded-2xl bg-surface text-fg hover:rounded-xl hover:bg-overlay",
        drop.over && DROP_OVER,
      )}
    >
      {collection.emoji ? (
        <span className="text-xl leading-none">{collection.emoji}</span>
      ) : (
        <Clock className={cn("size-5", collection.active && "fill-current")} />
      )}
    </button>
  );
}

function CollectionButton({
  collection,
  onClick,
  onRemove,
  onEdit,
  onDropFiles,
  t,
}: {
  collection: UserCollection;
  onClick: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onDropFiles: (files: DraggedFile[]) => void;
  t: TFunc;
}) {
  const sortable = useSortable({ id: collection.id, animateLayoutChanges });
  const drop = useFileDropTarget(onDropFiles);
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
            {...drop.handlers}
            className={cn(
              "flex size-11 touch-none items-center justify-center text-sm font-semibold transition",
              collection.active
                ? "rounded-xl bg-primary text-primary-foreground ring-2 ring-fg/40"
                : "rounded-2xl bg-surface text-fg hover:rounded-xl hover:bg-overlay",
              drop.over && DROP_OVER,
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

/**
 * Full-window drop zone while a drag from the OS is over the window. It never
 * takes the pointer: the drag events keep reaching the window listeners that
 * count enters and leaves.
 */
function FolderDropOverlay({ t }: { t: TFunc }) {
  return (
    <div
      data-testid="folder-drop-overlay"
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm"
    >
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-surface/90 px-10 py-8 text-center">
        <FolderPlus className="size-10 text-primary" />
        <p className="text-base font-semibold text-bright-fg">
          {t("drop.overlayTitle")}
        </p>
        <p className="text-sm text-muted">{t("drop.foldersOnly")}</p>
      </div>
    </div>
  );
}
