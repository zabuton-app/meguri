// Drag-to-reorder for the media views, used only while a collection is shown in
// its manual order. The order being edited is the collection's stored item
// order (config.json), so a drop reports the loaded window's new order and the
// main process rearranges just those slots — items outside the window never move.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FileRow } from "@/ipc/types";
import { mediaSortId } from "@/lib/mediaSortId";
import { cn } from "@/lib/utils";

/** What a media view needs to offer reordering; absent means "not reorderable". */
export interface MediaReorder {
  /** Receives the loaded items in their new order. */
  onReorder: (items: FileRow[]) => void;
}

export function MediaReorderProvider({
  items,
  reorder,
  children,
}: {
  items: FileRow[];
  reorder?: MediaReorder;
  children: ReactNode;
}) {
  // A short activation distance keeps plain clicks (open the file, toggle a
  // heart) working; only a deliberate drag starts a reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = useMemo(() => items.map(mediaSortId), [items]);
  // The pointerup that drops an item is still followed by a click on it, and
  // media items are links: dnd-kit only stops that click from propagating, so
  // the anchor's own default action still navigated to the dragged file's
  // detail view. Cancelling it has to happen in a document-level capture
  // listener — dnd-kit's own stopPropagation there keeps the click from ever
  // reaching React's delegated handlers. The flag is raised when a drag ends
  // and cleared by the next pointerdown, so a drag followed by no click cannot
  // swallow an unrelated later one.
  const draggedRef = useRef(false);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!draggedRef.current) return;
      draggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerDown = () => {
      draggedRef.current = false;
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  if (!reorder) return <>{children}</>;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    draggedRef.current = true;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorder.onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToFirstScrollableAncestor]}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        draggedRef.current = true;
      }}
    >
      {/* rect strategy covers all three views: grid rows, list rows and table rows. */}
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * Makes one rendered media item draggable, as a wrapper around it. A view whose
 * rows position themselves with a transform cannot use this — the two would
 * fight over that transform — and hands the drag wiring down to the row instead;
 * see MediaTable's SortableTableRow.
 */
export function SortableMedia({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  // useSortable's node ref, transform and drag state are read and applied during
  // render by design; routing them through state would break DnD.
  //
  // The wrapper is a drag handle around content that already has its own
  // semantics (a card containing a link). Left at dnd-kit's default role of
  // "button" it would announce as a control and add a second tab stop over the
  // grid's existing keyboard navigation.
  const sortable = useSortable({ id, attributes: { role: "presentation" } });
  const { setNodeRef, transition, isDragging, attributes, listeners } =
    sortable;
  const transform = CSS.Transform.toString(sortable.transform) || undefined;

  return (
    <div
      ref={setNodeRef}
      style={{ transform, transition, zIndex: isDragging ? 1 : undefined }}
      className={cn("touch-none", isDragging && "opacity-60")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
