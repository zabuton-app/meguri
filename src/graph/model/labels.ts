// Node sizes of the graph.

export const MIN_NODE_SIZE = 4;
export const MAX_NODE_SIZE = 22;

/** Grows with the square root of the degree, so a hub with thousands of
 *  links stays a large dot rather than filling the screen. */
export function nodeSize(degree: number): number {
  const size = 3 + 2 * Math.sqrt(Math.max(0, degree));
  return Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, size));
}
