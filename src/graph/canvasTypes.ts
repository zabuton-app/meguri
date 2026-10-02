// What the graph view and either canvas (flat: GraphCanvas, 3D:
// GraphCanvas3D) agree on, so the view can swap one for the other.
import type { DisplaySettings } from "./graphSettings";
import type { MediaGraph } from "./model/types";
import type { Visibility } from "./model/visibility";
import type { GraphColors } from "./useGraphColors";

export interface GraphCanvasHandle {
  /** Frame the visible nodes. */
  fit(animate?: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Centre the camera on a node, zooming in to where labels show. */
  focus(key: string): void;
}

export interface GraphCanvasProps {
  graph: MediaGraph;
  colors: GraphColors;
  visibility: Visibility;
  /** The node whose neighbourhood is highlighted (the rest fades). */
  focus: string | null;
  display: DisplaySettings;
  onHover: (key: string | null) => void;
  onClickNode: (key: string) => void;
  onClickStage: () => void;
  /** A press on a node became a drag; false refuses it. */
  onDragStart: (key: string) => boolean;
  /** The dragged node's new position, in graph coordinates (z in 3D). */
  onDrag: (key: string, x: number, y: number, z?: number) => void;
  onDragEnd: (key: string) => void;
  /** The user moved the camera (wheel, pan, zoom buttons). */
  onCameraInput?: () => void;
}
