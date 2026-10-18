// When the flat graph draws file nodes as their thumbnails rather than as
// dots: switched on, and few enough files on show that the pictures can still
// be told apart. Counted over what the toggles leave visible, which changes
// with the data and the filters, never with the camera, so zooming or
// panning never flips the view between the two.
import type { GraphDims } from "@shared/ipc/graph";
import type { DisplaySettings } from "../graphSettings";
import type { MediaGraph } from "./types";
import type { Visibility } from "./visibility";

/** The smallest radius of a file node while thumbnails are drawn, in graph
 *  units (dots go down to 8): small enough pictures are just blurs. */
export const THUMB_MIN_RADIUS = 14;

/** File nodes the view shows now (tags are not counted). */
export function visibleFileCount(
  graph: MediaGraph,
  visibility: Visibility,
): number {
  let n = 0;
  for (const key of visibility.nodes)
    if (graph.hasNode(key) && graph.getNodeAttribute(key, "type") === "file")
      n++;
  return n;
}

interface ThumbnailState {
  display: Pick<DisplaySettings, "thumbnails" | "thumbnailLimit">;
  visibleFiles: number;
  dims: GraphDims;
}

/** File nodes are drawn as their thumbnails. */
export function thumbnailsActive({
  display,
  visibleFiles,
  dims,
}: ThumbnailState): boolean {
  return (
    dims === 2 &&
    display.thumbnails &&
    visibleFiles > 0 &&
    visibleFiles <= display.thumbnailLimit
  );
}

/** Thumbnails are switched on but there are too many files for them: the
 *  settings panel says so, rather than leaving the viewer to guess. */
export function thumbnailsOverLimit({
  display,
  visibleFiles,
  dims,
}: ThumbnailState): boolean {
  return (
    dims === 2 && display.thumbnails && visibleFiles > display.thumbnailLimit
  );
}
