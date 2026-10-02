// The graph settings panel's values (Display and Forces, as in Obsidian's
// graph view), remembered per viewer. Forces are stored as the slider
// positions; physicsOf() turns them into the simulation's parameters with
// Obsidian's curves: centre and link strength ease in exponentially, repel is
// the cube of its slider.
import { useCallback, useState } from "react";
import type { SizeBy } from "./model/appearance";
import type { Physics } from "./sim/physics";

export const GRAPH_SETTINGS_KEY = "meguri.graph.settings";

export type { SizeBy };
export const SIZE_BY: readonly SizeBy[] = ["links", "plays"];

export interface DisplaySettings {
  sizeBy: SizeBy;
  /** Shifts the zoom at which labels fade in (-3..3; higher fades later). */
  textFade: number;
  nodeSize: number;
  lineSize: number;
}

export interface ForceSettings {
  /** Slider positions, 0..1. */
  center: number;
  /** 0..20; the force is its cube. */
  repel: number;
  /** 0..1. */
  link: number;
  /** 30..500. */
  distance: number;
}

export interface GraphSettings {
  display: DisplaySettings;
  forces: ForceSettings;
}

/** The display settings that are sliders. */
export type DisplayScale = Exclude<keyof DisplaySettings, "sizeBy">;

/** Slider ranges: [min, max, step]. */
export const DISPLAY_RANGE: Record<DisplayScale, [number, number, number]> = {
  textFade: [-3, 3, 0.1],
  nodeSize: [0.1, 5, 0.01],
  lineSize: [0.1, 5, 0.01],
};
export const FORCE_RANGE: Record<
  keyof ForceSettings,
  [number, number, number]
> = {
  center: [0, 1, 0.01],
  repel: [0, 20, 0.01],
  link: [0, 1, 0.01],
  distance: [30, 500, 1],
};

const EASE = 0.01;

/** Slider position (0..1) to strength: 0 at 0, 1 at 1, exponential between. */
export function eased(v: number): number {
  return (Math.pow(EASE, 1 - v) - EASE) / (1 - EASE);
}

/** The slider position that gives `strength`. */
export function uneased(strength: number): number {
  return 1 - Math.log(strength * (1 - EASE) + EASE) / Math.log(EASE);
}

export function defaultGraphSettings(): GraphSettings {
  return {
    display: { sizeBy: "links", textFade: 0, nodeSize: 1, lineSize: 1 },
    forces: {
      center: uneased(0.1),
      repel: 10,
      link: uneased(1),
      distance: 250,
    },
  };
}

export function physicsOf(f: ForceSettings): Physics {
  return {
    centerStrength: eased(f.center),
    repelStrength: f.repel * f.repel * f.repel,
    linkStrength: eased(f.link),
    linkDistance: f.distance,
  };
}

function clampTo(
  value: unknown,
  [min, max]: [number, number, number],
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function section<T extends object, K extends keyof T & string>(
  raw: unknown,
  ranges: Record<K, [number, number, number]>,
  fallback: T,
): T {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = { ...fallback };
  for (const key of Object.keys(ranges) as K[])
    (out as Record<string, number>)[key] = clampTo(
      o[key],
      ranges[key],
      fallback[key] as number,
    );
  return out;
}

/** A stored value, with anything missing or out of range replaced. */
export function parseGraphSettings(raw: string | null): GraphSettings {
  const fallback = defaultGraphSettings();
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const display = section(v?.display, DISPLAY_RANGE, fallback.display);
    const sizeBy = (v?.display as Record<string, unknown> | undefined)?.sizeBy;
    if (SIZE_BY.includes(sizeBy as SizeBy)) display.sizeBy = sizeBy as SizeBy;
    return {
      display,
      forces: section(v?.forces, FORCE_RANGE, fallback.forces),
    };
  } catch {
    return fallback;
  }
}

export function useGraphSettings(): [
  GraphSettings,
  (next: GraphSettings) => void,
] {
  const [settings, setSettings] = useState(() => {
    try {
      return parseGraphSettings(localStorage.getItem(GRAPH_SETTINGS_KEY));
    } catch {
      return defaultGraphSettings();
    }
  });
  const update = useCallback((next: GraphSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(GRAPH_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* storage may be full or disabled */
    }
  }, []);
  return [settings, update];
}
