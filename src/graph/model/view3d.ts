// Camera arithmetic of the 3D view, kept apart from three.js so it can be
// tested without WebGL.

/** Pixels one graph unit spans at `depth` from a perspective camera with a
 *  vertical field of view of `fovDeg` degrees, in a viewport `height` pixels
 *  tall: the 3D counterpart of the flat view's scale. */
export function pixelsPerUnit(
  depth: number,
  fovDeg: number,
  height: number,
): number {
  if (depth <= 0) return Infinity;
  const half = (fovDeg * Math.PI) / 360;
  return height / 2 / (Math.tan(half) * depth);
}

/** How far a camera must stand from the centre of a sphere of `radius` to see
 *  all of it, with a margin, given the vertical field of view and the
 *  viewport's aspect (width / height): the narrower of the two angles rules. */
export function fitDistance(
  radius: number,
  fovDeg: number,
  aspect: number,
  margin = 1.15,
): number {
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const half = Math.min(vHalf, hHalf);
  return (Math.max(radius, 1) * margin) / Math.sin(half);
}

/** Centre and radius of a set of points given as flat [x, y, z, ...]. */
export function boundingSphere(points: ArrayLike<number>): {
  center: [number, number, number];
  radius: number;
} | null {
  const n = Math.floor(points.length / 3);
  if (n === 0) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const v = points[i * 3 + c];
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }
  const center: [number, number, number] = [
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  ];
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += (points[i * 3 + c] - center[c]) ** 2;
    if (d > r2) r2 = d;
  }
  return { center, radius: Math.sqrt(r2) };
}
