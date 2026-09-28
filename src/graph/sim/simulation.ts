// The alpha schedule around a force engine, as d3-force (and Obsidian) runs
// it: every tick alpha moves toward alphaTarget by ALPHA_DECAY, and the
// simulation stops once alpha is at or below ALPHA_MIN. Reheats only raise.
import type { ForceEngine } from "./engine";
import {
  ALPHA_DECAY,
  ALPHA_MIN,
  DEFAULT_PHYSICS,
  type Physics,
} from "./physics";

export class Simulation {
  alpha = 1;
  alphaTarget = 0;
  physics: Physics = DEFAULT_PHYSICS;

  constructor(readonly engine: ForceEngine) {}

  get active(): boolean {
    return this.alpha > ALPHA_MIN;
  }

  raise(alpha: number): void {
    if (alpha > this.alpha) this.alpha = alpha;
  }

  /** One tick; false (and nothing moves) once cooled down. */
  step(): boolean {
    if (!this.active) return false;
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    this.engine.tick(this.alpha, this.physics);
    return true;
  }
}
