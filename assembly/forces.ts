// A port of d3-force-3d's tick (forceX, forceY, forceZ, forceLink,
// forceManyBody, forceCollide, then velocity decay) over flat f64 arrays in
// linear memory, in 2 or 3 dimensions. In 2D d3-force-3d is d3-force; in 3D
// its trees are octrees. Operation order follows d3-force-3d 3.0 so results
// match it bit for bit.

// Tree record: children c0..c7 (i32; 4 used in 2D), point i32, pad, then
// value, x, y, z, r (f64).
const NODE: usize = 96;
const CHILD: usize = 0;
const POINT: usize = 32;
const VALUE: usize = 40;
const TX: usize = 48;
const TY: usize = 56;
const TZ: usize = 64;
const TR: usize = 72;

let dims: i32 = 2;
let children: i32 = 4;
let n: i32 = 0;
let m: i32 = 0;
let X: usize = 0;
let Y: usize = 0;
let Z: usize = 0;
let VX: usize = 0;
let VY: usize = 0;
let VZ: usize = 0;
let FX: usize = 0;
let FY: usize = 0;
let FZ: usize = 0;
let QX: usize = 0;
let QY: usize = 0;
let QZ: usize = 0;
let NEXT: usize = 0;
let DEG: usize = 0;
let LS: usize = 0;
let LT: usize = 0;
let BIAS: usize = 0;
let LBASE: usize = 0;
let TREE: usize = 0;
let treeCap: i32 = 0;
let treeLen: i32 = 0;
let root: i32 = -1;
let rx0: f64 = 0;
let ry0: f64 = 0;
let rz0: f64 = 0;
let rx1: f64 = 0;
let ry1: f64 = 0;
let rz1: f64 = 0;
let seed: u32 = 1;

// Per-tick parameters shared by the recursive visits.
let alpha: f64 = 0;
let theta2: f64 = 0.81;
let distMin2: f64 = 900;
let charge: f64 = -1000;
let radius: f64 = 60;
let collideStrength: f64 = 0.5;
let ci: i32 = 0;
let cx: f64 = 0;
let cy: f64 = 0;
let cz: f64 = 0;
let cvx: f64 = 0;
let cvy: f64 = 0;
let cvz: f64 = 0;
let ri: f64 = 0;
let ri2: f64 = 0;
let xi: f64 = 0;
let yi: f64 = 0;
let zi: f64 = 0;

function f(base: usize, i: i32): f64 {
  return load<f64>(base + ((<usize>i) << 3));
}
function setF(base: usize, i: i32, v: f64): void {
  store<f64>(base + ((<usize>i) << 3), v);
}
function g(base: usize, i: i32): i32 {
  return load<i32>(base + ((<usize>i) << 2));
}
function setG(base: usize, i: i32, v: i32): void {
  store<i32>(base + ((<usize>i) << 2), v);
}
function rec(k: i32): usize {
  return TREE + <usize>k * NODE;
}

function ensure(end: usize): void {
  const have = (<usize>memory.size()) << 16;
  if (end > have) {
    if (memory.grow(<i32>((end - have + 0xffff) >> 16)) < 0) unreachable();
  }
}

function align(p: usize, a: usize): usize {
  return (p + a - 1) & ~(a - 1);
}

function jiggle(): f64 {
  seed = seed * 1664525 + 1013904223;
  return (<f64>seed / 4294967296.0 - 0.5) * 1e-6;
}

/** Lays out memory for `nodes` nodes and `links` links in `dimensions` (2 or
 *  3). Every array is zeroed except fx/fy/fz (NaN = free). */
export function setup(nodes: i32, links: i32, dimensions: i32): void {
  dims = dimensions == 3 ? 3 : 2;
  children = dims == 3 ? 8 : 4;
  n = nodes;
  m = links;
  const nb = (<usize>n) << 3;
  let p = align(__heap_base, 64);
  X = p;
  p += nb;
  Y = p;
  p += nb;
  Z = p;
  p += nb;
  VX = p;
  p += nb;
  VY = p;
  p += nb;
  VZ = p;
  p += nb;
  FX = p;
  p += nb;
  FY = p;
  p += nb;
  FZ = p;
  p += nb;
  QX = p;
  p += nb;
  QY = p;
  p += nb;
  QZ = p;
  p += nb;
  NEXT = p;
  p += (<usize>n) << 2;
  DEG = p;
  p += (<usize>n) << 2;
  p = align(p, 8);
  LS = p;
  p += (<usize>m) << 2;
  LT = p;
  p += (<usize>m) << 2;
  p = align(p, 8);
  BIAS = p;
  p += (<usize>m) << 3;
  LBASE = p;
  p += (<usize>m) << 3;
  TREE = align(p, 64);
  treeCap = max(64, n * 2);
  ensure(TREE + <usize>treeCap * NODE);
  memory.fill(X, 0, TREE - X);
  for (let i = 0; i < n; i++) {
    setF(FX, i, NaN);
    setF(FY, i, NaN);
    setF(FZ, i, NaN);
  }
  seed = 1;
}

export function xPtr(): usize {
  return X;
}
export function yPtr(): usize {
  return Y;
}
export function zPtr(): usize {
  return Z;
}
export function fxPtr(): usize {
  return FX;
}
export function fyPtr(): usize {
  return FY;
}
export function fzPtr(): usize {
  return FZ;
}
export function sourcePtr(): usize {
  return LS;
}
export function targetPtr(): usize {
  return LT;
}

/** Degrees, biases and d3's default link strength (1 / min degree), after links are written. */
export function prepareLinks(): void {
  memory.fill(DEG, 0, (<usize>n) << 2);
  for (let b = 0; b < m; b++) {
    const s = g(LS, b);
    const t = g(LT, b);
    setG(DEG, s, g(DEG, s) + 1);
    setG(DEG, t, g(DEG, t) + 1);
  }
  for (let b = 0; b < m; b++) {
    const ds = <f64>g(DEG, g(LS, b));
    const dt = <f64>g(DEG, g(LT, b));
    setF(BIAS, b, ds / (ds + dt));
    setF(LBASE, b, 1 / Math.min(ds, dt));
  }
}

// ---- quad/octree (d3-quadtree's and d3-octree's cover/add, over QX/QY/QZ) ----

function newNode(point: i32): i32 {
  if (treeLen == treeCap) {
    treeCap <<= 1;
    ensure(TREE + <usize>treeCap * NODE);
  }
  const k = treeLen++;
  const r = rec(k);
  store<i64>(r, -1, CHILD);
  store<i64>(r, -1, CHILD + 8);
  store<i64>(r, -1, CHILD + 16);
  store<i64>(r, -1, CHILD + 24);
  store<i32>(r, point, POINT);
  return k;
}

function child(k: i32, i: i32): i32 {
  return load<i32>(rec(k) + CHILD + ((<usize>i) << 2));
}
function setChild(k: i32, i: i32, v: i32): void {
  store<i32>(rec(k) + CHILD + ((<usize>i) << 2), v);
}
function pointOf(k: i32): i32 {
  return load<i32>(rec(k), POINT);
}

function insert(i: i32, x: f64, y: f64, z: f64): void {
  if (root < 0) {
    root = newNode(i);
    return;
  }
  const deep3 = dims == 3;
  let node = root;
  let parent = -1;
  let slot = 0;
  let x0 = rx0,
    y0 = ry0,
    z0 = rz0,
    x1 = rx1,
    y1 = ry1,
    z1 = rz1;
  while (pointOf(node) < 0) {
    const xm = (x0 + x1) / 2;
    const right = x >= xm;
    if (right) x0 = xm;
    else x1 = xm;
    const ym = (y0 + y1) / 2;
    const bottom = y >= ym;
    if (bottom) y0 = ym;
    else y1 = ym;
    let deep = false;
    if (deep3) {
      const zm = (z0 + z1) / 2;
      deep = z >= zm;
      if (deep) z0 = zm;
      else z1 = zm;
    }
    parent = node;
    slot = ((<i32>deep) << 2) | ((<i32>bottom) << 1) | (<i32>right);
    node = child(parent, slot);
    if (node < 0) {
      setChild(parent, slot, newNode(i));
      return;
    }
  }
  const p = pointOf(node);
  const xp = f(QX, p);
  const yp = f(QY, p);
  const zp = deep3 ? f(QZ, p) : 0;
  if (x == xp && y == yp && (!deep3 || z == zp)) {
    // Coincident: the new point heads the leaf's chain, as d3 does.
    setG(NEXT, i, p);
    store<i32>(rec(node), i, POINT);
    return;
  }
  let j = 0;
  do {
    const nn = newNode(-1);
    if (parent < 0) root = nn;
    else setChild(parent, slot, nn);
    parent = nn;
    const xm = (x0 + x1) / 2;
    const right = x >= xm;
    if (right) x0 = xm;
    else x1 = xm;
    const ym = (y0 + y1) / 2;
    const bottom = y >= ym;
    if (bottom) y0 = ym;
    else y1 = ym;
    let deep = false;
    let pdeep = false;
    if (deep3) {
      const zm = (z0 + z1) / 2;
      deep = z >= zm;
      if (deep) z0 = zm;
      else z1 = zm;
      pdeep = zp >= zm;
    }
    slot = ((<i32>deep) << 2) | ((<i32>bottom) << 1) | (<i32>right);
    j = ((<i32>pdeep) << 2) | ((<i32>(yp >= ym)) << 1) | (<i32>(xp >= xm));
  } while (slot == j);
  setChild(parent, j, node);
  setChild(parent, slot, newNode(i));
}

function build(): void {
  treeLen = 0;
  root = -1;
  const deep3 = dims == 3;
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    setG(NEXT, i, -1);
    const x = f(QX, i);
    const y = f(QY, i);
    const z = deep3 ? f(QZ, i) : 0;
    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (x0 > x1 || y0 > y1 || z0 > z1) return;
  rx0 = Math.floor(x0);
  ry0 = Math.floor(y0);
  rz0 = Math.floor(z0);
  rx1 = rx0 + 1;
  ry1 = ry0 + 1;
  rz1 = rz0 + 1;
  let t: f64 = 1;
  while (
    rx0 > x1 ||
    x1 >= rx1 ||
    ry0 > y1 ||
    y1 >= ry1 ||
    (deep3 && (rz0 > z1 || z1 >= rz1))
  ) {
    t *= 2;
    rx1 = rx0 + t;
    ry1 = ry0 + t;
    rz1 = rz0 + t;
  }
  for (let i = 0; i < n; i++) {
    const x = f(QX, i);
    const y = f(QY, i);
    const z = deep3 ? f(QZ, i) : 0;
    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
    insert(i, x, y, z);
  }
}

// ---- forceManyBody ----

// d3-force-3d scales an internal node's strength by √(4 / children): 1 for a
// quadtree, √½ for an octree.
let childScale: f64 = 1;

function accumulate(k: i32): void {
  const r = rec(k);
  const p = load<i32>(r, POINT);
  let strength: f64 = 0;
  if (p < 0) {
    let weight: f64 = 0,
      sx: f64 = 0,
      sy: f64 = 0,
      sz: f64 = 0;
    for (let i = 0; i < children; i++) {
      const c = child(k, i);
      if (c < 0) continue;
      accumulate(c);
      const cr = rec(c);
      const v = load<f64>(cr, VALUE);
      const a = Math.abs(v);
      if (a != 0) {
        strength += v;
        weight += a;
        sx += a * load<f64>(cr, TX);
        sy += a * load<f64>(cr, TY);
        sz += a * load<f64>(cr, TZ);
      }
    }
    strength *= childScale;
    store<f64>(r, sx / weight, TX);
    store<f64>(r, sy / weight, TY);
    store<f64>(r, dims == 3 ? sz / weight : 0, TZ);
  } else {
    store<f64>(r, f(QX, p), TX);
    store<f64>(r, f(QY, p), TY);
    store<f64>(r, dims == 3 ? f(QZ, p) : 0, TZ);
    let q = p;
    do {
      strength += charge;
      q = g(NEXT, q);
    } while (q >= 0);
  }
  store<f64>(r, strength, VALUE);
}

function chargeVisit(k: i32, x0: f64, x1: f64): void {
  const r = rec(k);
  const value = load<f64>(r, VALUE);
  if (value == 0) return;
  const deep3 = dims == 3;
  let dx = load<f64>(r, TX) - cx;
  let dy = load<f64>(r, TY) - cy;
  let dz = deep3 ? load<f64>(r, TZ) - cz : 0;
  const w = x1 - x0;
  let l = dx * dx + dy * dy + dz * dz;
  if ((w * w) / theta2 < l) {
    if (dx == 0) {
      dx = jiggle();
      l += dx * dx;
    }
    if (dy == 0) {
      dy = jiggle();
      l += dy * dy;
    }
    if (deep3 && dz == 0) {
      dz = jiggle();
      l += dz * dz;
    }
    if (l < distMin2) l = Math.sqrt(distMin2 * l);
    cvx += (dx * value * alpha) / l;
    cvy += (dy * value * alpha) / l;
    if (deep3) cvz += (dz * value * alpha) / l;
    return;
  }
  const p = load<i32>(r, POINT);
  if (p < 0) {
    const xm = (x0 + x1) / 2;
    for (let i = 0; i < children; i++) {
      const c = child(k, i);
      if (c < 0) continue;
      if (i & 1) chargeVisit(c, xm, x1);
      else chargeVisit(c, x0, xm);
    }
    return;
  }
  if (p != ci || g(NEXT, p) >= 0) {
    if (dx == 0) {
      dx = jiggle();
      l += dx * dx;
    }
    if (dy == 0) {
      dy = jiggle();
      l += dy * dy;
    }
    if (deep3 && dz == 0) {
      dz = jiggle();
      l += dz * dz;
    }
    if (l < distMin2) l = Math.sqrt(distMin2 * l);
  }
  let q = p;
  do {
    if (q != ci) {
      const ww = (charge * alpha) / l;
      cvx += dx * ww;
      cvy += dy * ww;
      if (deep3) cvz += dz * ww;
    }
    q = g(NEXT, q);
  } while (q >= 0);
}

// ---- forceCollide ----

function prepare(k: i32): void {
  const r = rec(k);
  if (load<i32>(r, POINT) >= 0) {
    store<f64>(r, radius, TR);
    return;
  }
  let best: f64 = 0;
  for (let i = 0; i < children; i++) {
    const c = child(k, i);
    if (c < 0) continue;
    prepare(c);
    const cr = load<f64>(rec(c), TR);
    if (cr > best) best = cr;
  }
  store<f64>(r, best, TR);
}

function collideVisit(
  k: i32,
  x0: f64,
  y0: f64,
  z0: f64,
  x1: f64,
  y1: f64,
  z1: f64,
): void {
  const deep3 = dims == 3;
  const rr = rec(k);
  const p = load<i32>(rr, POINT);
  let rj = load<f64>(rr, TR);
  let r = ri + rj;
  if (p >= 0) {
    if (p > ci) {
      let dx = xi - f(X, p) - f(VX, p);
      let dy = yi - f(Y, p) - f(VY, p);
      let dz = deep3 ? zi - f(Z, p) - f(VZ, p) : 0;
      let l = dx * dx + dy * dy + dz * dz;
      if (l < r * r) {
        if (dx == 0) {
          dx = jiggle();
          l += dx * dx;
        }
        if (dy == 0) {
          dy = jiggle();
          l += dy * dy;
        }
        if (deep3 && dz == 0) {
          dz = jiggle();
          l += dz * dz;
        }
        l = Math.sqrt(l);
        l = ((r - l) / l) * collideStrength;
        dx *= l;
        dy *= l;
        dz *= l;
        rj *= rj;
        r = rj / (ri2 + rj);
        setF(VX, ci, f(VX, ci) + dx * r);
        setF(VY, ci, f(VY, ci) + dy * r);
        if (deep3) setF(VZ, ci, f(VZ, ci) + dz * r);
        r = 1 - r;
        setF(VX, p, f(VX, p) - dx * r);
        setF(VY, p, f(VY, p) - dy * r);
        if (deep3) setF(VZ, p, f(VZ, p) - dz * r);
      }
    }
    return;
  }
  if (
    x0 > xi + r ||
    x1 < xi - r ||
    y0 > yi + r ||
    y1 < yi - r ||
    (deep3 && (z0 > zi + r || z1 < zi - r))
  )
    return;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const zm = (z0 + z1) / 2;
  for (let i = 0; i < children; i++) {
    const c = child(k, i);
    if (c < 0) continue;
    const right = i & 1;
    const bottom = i & 2;
    const deep = i & 4;
    collideVisit(
      c,
      right ? xm : x0,
      bottom ? ym : y0,
      deep ? zm : z0,
      right ? x1 : xm,
      bottom ? y1 : ym,
      deep ? z1 : zm,
    );
  }
}

/** One d3 tick at the given alpha (the caller owns the alpha schedule). */
export function tick(
  a: f64,
  center: f64,
  linkStrength: f64,
  linkDistance: f64,
  repel: f64,
  theta: f64,
  distanceMin: f64,
  collideRadius: f64,
  collideK: f64,
  velocityDecay: f64,
): void {
  const deep3 = dims == 3;
  alpha = a;
  theta2 = theta * theta;
  distMin2 = distanceMin * distanceMin;
  charge = repel;
  radius = collideRadius;
  collideStrength = collideK;
  childScale = Math.sqrt(4 / <f64>children);

  // forceX / forceY / forceZ toward 0.
  for (let i = 0; i < n; i++) {
    setF(VX, i, f(VX, i) + (0 - f(X, i)) * center * alpha);
  }
  for (let i = 0; i < n; i++) {
    setF(VY, i, f(VY, i) + (0 - f(Y, i)) * center * alpha);
  }
  if (deep3)
    for (let i = 0; i < n; i++) {
      setF(VZ, i, f(VZ, i) + (0 - f(Z, i)) * center * alpha);
    }

  // forceLink, one iteration.
  for (let b = 0; b < m; b++) {
    const s = g(LS, b);
    const t = g(LT, b);
    let dx = f(X, t) + f(VX, t) - f(X, s) - f(VX, s);
    if (dx == 0) dx = jiggle();
    let dy = f(Y, t) + f(VY, t) - f(Y, s) - f(VY, s);
    if (dy == 0) dy = jiggle();
    let dz: f64 = 0;
    if (deep3) {
      dz = f(Z, t) + f(VZ, t) - f(Z, s) - f(VZ, s);
      if (dz == 0) dz = jiggle();
    }
    let l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    l = ((l - linkDistance) / l) * alpha * (linkStrength * f(LBASE, b));
    dx *= l;
    dy *= l;
    dz *= l;
    let bb = f(BIAS, b);
    setF(VX, t, f(VX, t) - dx * bb);
    setF(VY, t, f(VY, t) - dy * bb);
    if (deep3) setF(VZ, t, f(VZ, t) - dz * bb);
    bb = 1 - bb;
    setF(VX, s, f(VX, s) + dx * bb);
    setF(VY, s, f(VY, s) + dy * bb);
    if (deep3) setF(VZ, s, f(VZ, s) + dz * bb);
  }

  // forceManyBody over positions.
  memory.copy(QX, X, (<usize>n) << 3);
  memory.copy(QY, Y, (<usize>n) << 3);
  if (deep3) memory.copy(QZ, Z, (<usize>n) << 3);
  build();
  if (root >= 0) {
    accumulate(root);
    for (let i = 0; i < n; i++) {
      ci = i;
      cx = f(X, i);
      cy = f(Y, i);
      cz = deep3 ? f(Z, i) : 0;
      cvx = f(VX, i);
      cvy = f(VY, i);
      cvz = deep3 ? f(VZ, i) : 0;
      chargeVisit(root, rx0, rx1);
      setF(VX, i, cvx);
      setF(VY, i, cvy);
      if (deep3) setF(VZ, i, cvz);
    }
  }

  // forceCollide over positions + velocities.
  for (let i = 0; i < n; i++) {
    setF(QX, i, f(X, i) + f(VX, i));
    setF(QY, i, f(Y, i) + f(VY, i));
    if (deep3) setF(QZ, i, f(Z, i) + f(VZ, i));
  }
  build();
  if (root >= 0) {
    prepare(root);
    ri = radius;
    ri2 = ri * ri;
    for (let i = 0; i < n; i++) {
      ci = i;
      xi = f(X, i) + f(VX, i);
      yi = f(Y, i) + f(VY, i);
      zi = deep3 ? f(Z, i) + f(VZ, i) : 0;
      collideVisit(root, rx0, ry0, rz0, rx1, ry1, rz1);
    }
  }

  // Velocity decay; pinned nodes sit at fx/fy/fz.
  for (let i = 0; i < n; i++) {
    const fx = f(FX, i);
    if (isNaN(fx)) {
      const v = f(VX, i) * velocityDecay;
      setF(VX, i, v);
      setF(X, i, f(X, i) + v);
    } else {
      setF(X, i, fx);
      setF(VX, i, 0);
    }
    const fy = f(FY, i);
    if (isNaN(fy)) {
      const v = f(VY, i) * velocityDecay;
      setF(VY, i, v);
      setF(Y, i, f(Y, i) + v);
    } else {
      setF(Y, i, fy);
      setF(VY, i, 0);
    }
    if (deep3) {
      const fz = f(FZ, i);
      if (isNaN(fz)) {
        const v = f(VZ, i) * velocityDecay;
        setF(VZ, i, v);
        setF(Z, i, f(Z, i) + v);
      } else {
        setF(Z, i, fz);
        setF(VZ, i, 0);
      }
    }
  }
}
