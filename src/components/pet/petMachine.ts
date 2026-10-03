// What the pet is doing, as a pure model: Pet.tsx feeds it events (pointer,
// timers, app events) and draws whatever displayState() says.
//
// Three layers decide the sprite, highest first: being held or falling, a
// queue of one-shot reactions, the app-driven poses (a file drag in progress,
// a scan running), and underneath them the pet's own idle / walk / sleep.
import type { PetState } from "./petSprites";

export type PetBase = "idle" | "walk" | "sleep" | "held" | "fall";

export type PetReaction =
  "land" | "hop" | "munch" | "headShake" | "cheer" | "lookAround" | "fold";

export interface PetModel {
  base: PetBase;
  /** Walking direction: -1 left, 1 right. */
  dir: -1 | 1;
  /** One-shot reactions played in order; the head is the one on screen. */
  reactions: readonly PetReaction[];
  /** Bumped whenever the head reaction changes, so the same reaction twice in
   *  a row still restarts its frames. */
  seq: number;
  /** An in-app file drag is in progress somewhere in the window. */
  fileDrag: boolean;
  /** A scan is running. */
  working: boolean;
}

export type PetEvent =
  | { type: "grab" }
  | { type: "release"; airborne: boolean }
  | { type: "landed" }
  | { type: "react"; reactions: readonly PetReaction[] }
  | { type: "reactionDone" }
  | { type: "wander"; dir: -1 | 1 }
  | { type: "rest" }
  | { type: "doze" }
  | { type: "fileDrag"; active: boolean }
  | { type: "working"; active: boolean };

/** Reactions queued beyond this are dropped rather than played out late. */
const MAX_REACTIONS = 3;

export const INITIAL_PET_MODEL: PetModel = {
  base: "idle",
  dir: 1,
  reactions: [],
  seq: 0,
  fileDrag: false,
  working: false,
};

/** Folding is the pet's last act before it hides: nothing interrupts it. */
function isFolding(model: PetModel): boolean {
  return model.reactions[0] === "fold";
}

function isAirborne(model: PetModel): boolean {
  return model.base === "held" || model.base === "fall";
}

/** Anything that asks for the pet's attention stops a walk and ends a nap. */
function attentive(base: PetBase): PetBase {
  return base === "walk" || base === "sleep" ? "idle" : base;
}

export function reducePet(model: PetModel, event: PetEvent): PetModel {
  switch (event.type) {
    case "grab":
      if (isFolding(model)) return model;
      return { ...model, base: "held", reactions: [], seq: model.seq + 1 };
    case "release":
      if (model.base !== "held") return model;
      return { ...model, base: event.airborne ? "fall" : "idle" };
    case "landed":
      if (model.base !== "fall") return model;
      return {
        ...model,
        base: "idle",
        reactions: ["land", ...model.reactions],
        seq: model.seq + 1,
      };
    case "react": {
      if (isFolding(model) || isAirborne(model)) return model;
      if (event.reactions.includes("fold")) {
        return {
          ...model,
          base: "idle",
          reactions: ["fold"],
          seq: model.seq + 1,
        };
      }
      const reactions = [...model.reactions, ...event.reactions].slice(
        0,
        MAX_REACTIONS,
      );
      return {
        ...model,
        base: attentive(model.base),
        reactions,
        seq: model.reactions.length === 0 ? model.seq + 1 : model.seq,
      };
    }
    case "reactionDone":
      if (model.reactions.length === 0) return model;
      return {
        ...model,
        reactions: model.reactions.slice(1),
        seq: model.seq + 1,
      };
    case "wander":
      if (!isQuiet(model)) return model;
      return { ...model, base: "walk", dir: event.dir };
    case "rest":
      if (model.base !== "walk") return model;
      return { ...model, base: "idle" };
    case "doze":
      if (!isQuiet(model)) return model;
      return { ...model, base: "sleep" };
    case "fileDrag":
      if (model.fileDrag === event.active) return model;
      return {
        ...model,
        fileDrag: event.active,
        base: event.active ? attentive(model.base) : model.base,
      };
    case "working":
      if (model.working === event.active) return model;
      return {
        ...model,
        working: event.active,
        base: event.active ? attentive(model.base) : model.base,
      };
  }
}

/**
 * The sprite state to draw. `scanning` is the app's own "a scan was just
 * asked for" flag, which covers the moment before the first progress event.
 */
export function displayState(model: PetModel, scanning = false): PetState {
  if (model.base === "held") return "held";
  if (model.base === "fall") return "fall";
  if (model.reactions.length > 0) return model.reactions[0];
  if (model.fileDrag) return "mouthOpen";
  if (model.working || scanning) return "work";
  return model.base;
}

/** Standing around with nothing asked of it: free to wander off or doze. */
export function isQuiet(model: PetModel, scanning = false): boolean {
  return displayState(model, scanning) === "idle";
}
