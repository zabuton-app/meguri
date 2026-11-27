// Whether the selection can open the image comparison.
/** Exactly two images, with no picked folder still fetching its files. */
export function canCompare(selection: {
  count: number;
  pending: boolean;
  rows: readonly { kind: string }[];
}): boolean {
  return (
    !selection.pending &&
    selection.count === 2 &&
    selection.rows.length === 2 &&
    selection.rows.every((row) => row.kind === "image")
  );
}
