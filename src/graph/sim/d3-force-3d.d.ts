// The parts of d3-force-3d (which ships no types) the fallback engine uses.
declare module "d3-force-3d" {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface SimLink {
    source: number | SimNode;
    target: number | SimNode;
  }
  export interface Force {
    (alpha: number): void;
  }
  export interface PositionForce extends Force {
    strength(s: number): this;
  }
  export interface LinkForce extends Force {
    links(): SimLink[];
    distance(d: number): this;
    strength(): (link: SimLink, i: number, links: SimLink[]) => number;
    strength(s: (link: SimLink, i: number, links: SimLink[]) => number): this;
  }
  export interface ManyBodyForce extends Force {
    strength(s: number): this;
    theta(t: number): this;
    distanceMin(d: number): this;
  }
  export interface CollideForce extends Force {
    strength(s: number): this;
  }
  export interface Simulation {
    stop(): this;
    alpha(a: number): this;
    alphaDecay(d: number): this;
    velocityDecay(d: number): this;
    force(name: string, force: Force | null): this;
    tick(iterations?: number): this;
  }
  export function forceSimulation(
    nodes: SimNode[],
    dimensions?: number,
  ): Simulation;
  export function forceX(x?: number): PositionForce;
  export function forceY(y?: number): PositionForce;
  export function forceZ(z?: number): PositionForce;
  export function forceLink(links: SimLink[]): LinkForce;
  export function forceManyBody(): ManyBodyForce;
  export function forceCollide(radius?: number): CollideForce;
}
