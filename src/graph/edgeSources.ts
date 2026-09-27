// The renderer's side of the relationship kinds: how each is named, drawn in
// the legend and switched. Adding a kind (see electron/core/graph/edgeSources.ts)
// means one more row here, plus its look in GraphCanvas's edge reducer, which
// draws every kind alike today.
import type { EdgeSourceId } from "@shared/ipc/graph";
import type { TranslationKey } from "@/i18n/locales/ja";

export interface EdgeSourceInfo {
  id: EdgeSourceId;
  label: TranslationKey;
  /** Legend line style. */
  line: "solid" | "dashed";
  defaultOn: boolean;
}

export const EDGE_SOURCE_INFO: readonly EdgeSourceInfo[] = [
  { id: "tag", label: "graph.edge.tag", line: "solid", defaultOn: true },
];
