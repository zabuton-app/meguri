// The renderer's side of the relationship kinds: how each is named, drawn in
// the legend and switched. Adding a kind (see electron/core/graph/edgeSources.ts)
// means one more row here (the compiler asks for it), plus its look in
// GraphCanvas's edge reducer, which draws every kind alike today.
import type { EdgeSourceId } from "@shared/ipc/graph";
import type { TranslationKey } from "@/i18n/locales/ja";

export interface EdgeSourceInfo {
  id: EdgeSourceId;
  label: TranslationKey;
  /** Legend line style. */
  line: "solid" | "dashed";
  defaultOn: boolean;
}

/** Keyed by id so a new EdgeSourceId fails to compile until it has a row. */
const INFO: { [K in EdgeSourceId]: Omit<EdgeSourceInfo, "id"> } = {
  tag: { label: "graph.edge.tag", line: "solid", defaultOn: true },
};

export const EDGE_SOURCE_INFO: readonly EdgeSourceInfo[] = (
  Object.keys(INFO) as EdgeSourceId[]
).map((id) => ({ id, ...INFO[id] }));
