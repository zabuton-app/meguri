/** Tag chip background class by source (shared across Grid / List / Table views). */
export function tagColorClass(source: string): string {
  if (source === "manual") return "bg-primary/25 text-fg";
  if (source === "auto-meta") return "bg-info/25 text-fg";
  return "bg-overlay text-fg";
}
