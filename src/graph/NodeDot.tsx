// The small swatch that stands for a node in the legend and the inspector,
// drawn with the same semantic colours the canvas uses.
import { cn } from "@/lib/utils";
import type { NodeAttrs } from "./model/types";

function nodeDotClass(
  type: "file" | "tag",
  fileKind?: string,
  auto?: boolean,
): string {
  if (type === "tag")
    return auto
      ? "border-2 border-secondary-fg bg-bg"
      : "border-2 border-accent2 bg-bg";
  if (fileKind === "image") return "bg-secondary-accent";
  if (fileKind === "audio") return "bg-info";
  return "bg-primary";
}

export function NodeDot({
  node,
  type = node?.type ?? "file",
  fileKind = node?.type === "file" ? node.fileKind : undefined,
  auto = node?.type === "tag" && node.auto,
  className,
}: {
  /** A graph node to stand for; or give its kind with the props below. */
  node?: NodeAttrs;
  type?: "file" | "tag";
  fileKind?: string;
  /** A generated tag. */
  auto?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        nodeDotClass(type, fileKind, auto),
        className,
      )}
    />
  );
}
