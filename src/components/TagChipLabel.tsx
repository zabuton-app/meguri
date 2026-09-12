/**
 * Renders a tag as `namespace:name` with the namespace dimmed, so a generated
 * tag reads as one token while still showing which category produced it.
 * Presentation only — the value used for filtering is qualifiedTagName().
 */
export function TagChipLabel({
  namespace,
  name,
}: {
  namespace: string;
  name: string;
}) {
  return (
    <>
      {namespace && <span className="opacity-60">{namespace}:</span>}
      {name}
    </>
  );
}
