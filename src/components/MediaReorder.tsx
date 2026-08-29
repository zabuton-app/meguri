// Drag-to-reorder for the media views, used only while a collection is shown in
// its manual order. The order being edited is the collection's stored item
// order (config.json), so a drop reports the loaded window's new order and the
// main process rearranges just those slots — items outside the window never move.
import { useMemo, type CSSProperties, type ReactNode } from "react";
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

  if (!reorder) return <>{children}</>;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
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
    >
      {/* rect strategy covers all three views: grid rows, list rows and table rows. */}
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * Makes one rendered media item draggable. `baseTransform` is composed in front
 * of the drag transform so a virtualized row keeps its own positioning.
 */
export function SortableMedia({
  id,
  className,
  baseTransform,
  style,
  children,
}: {
  id: string;
  className?: string;
  baseTransform?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // useSortable's node ref, transform and drag state are read and applied during
  // render by design; routing them through state would break DnD.
  const sortable = useSortable({ id });
  const { setNodeRef, transition, isDragging, attributes, listeners } =
    sortable;
  const drag = CSS.Transform.toString(sortable.transform);
  const transform =
    [baseTransform, drag].filter(Boolean).join(" ") || undefined;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        transform,
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
      className={cn("touch-none", className, isDragging && "opacity-60")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
