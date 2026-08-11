import { AUTO_META_SOURCE } from "@shared/tags";

/** `chip` = translucent (list views, Discover, the tag screen); `solid` = filled (detail pane). */
export type TagTone = "chip" | "solid";

/**
 * Tag chip colour by source. Single definition on purpose — the detail pane used
 * to carry its own copy, which meant every new source had to be added twice.
 */
export function tagColorClass(source: string, tone: TagTone = "chip"): string {
  if (source === "manual") {
    return tone === "solid"
      ? "bg-primary text-primary-foreground"
      : "bg-primary/25 text-fg";
  }
  if (source === AUTO_META_SOURCE) {
    return tone === "solid" ? "bg-info text-bg" : "bg-info/25 text-fg";
  }
  return "bg-overlay text-fg";
}
