// The ForceAtlas2 package's internals the layout engine drives directly
// (plain CommonJS modules without their own typings).
declare module "graphology-layout-forceatlas2/iterate.js" {
  /** One ForceAtlas2 iteration over the node and edge matrices, in place. */
  export default function iterate(
    settings: Record<string, number | boolean>,
    nodes: Float32Array,
    edges: Float32Array,
  ): void;
}

declare module "graphology-layout-forceatlas2/defaults.js" {
  const defaults: Record<string, number | boolean>;
  export default defaults;
}
