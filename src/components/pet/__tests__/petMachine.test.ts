import { describe, expect, it } from "vitest";
import {
  displayState,
  INITIAL_PET_MODEL,
  isQuiet,
  reducePet,
  type PetEvent,
  type PetModel,
} from "../petMachine";

function run(events: PetEvent[], from: PetModel = INITIAL_PET_MODEL) {
  return events.reduce(reducePet, from);
}

describe("pet machine", () => {
  it("starts out standing around, free to wander", () => {
    expect(displayState(INITIAL_PET_MODEL)).toBe("idle");
    expect(isQuiet(INITIAL_PET_MODEL)).toBe(true);
  });

  it("walks when it wanders and stops when it rests", () => {
    const walking = run([{ type: "wander", dir: -1 }]);
    expect(displayState(walking)).toBe("walk");
    expect(walking.dir).toBe(-1);
    expect(displayState(run([{ type: "rest" }], walking))).toBe("idle");
  });

  it("falls when released in mid-air and squashes on landing", () => {
    const held = run([{ type: "grab" }]);
    expect(displayState(held)).toBe("held");
    const falling = run([{ type: "release", airborne: true }], held);
    expect(displayState(falling)).toBe("fall");
    const landed = run([{ type: "landed" }], falling);
    expect(displayState(landed)).toBe("land");
    expect(displayState(run([{ type: "reactionDone" }], landed))).toBe("idle");
  });

  it("goes straight back to standing when released on the floor", () => {
    const model = run([{ type: "grab" }, { type: "release", airborne: false }]);
    expect(displayState(model)).toBe("idle");
  });

  it("plays queued reactions in order", () => {
    const eating = run([{ type: "react", reactions: ["munch", "cheer"] }]);
    expect(displayState(eating)).toBe("munch");
    const cheering = run([{ type: "reactionDone" }], eating);
    expect(displayState(cheering)).toBe("cheer");
    expect(displayState(run([{ type: "reactionDone" }], cheering))).toBe(
      "idle",
    );
  });

  it("restarts a reaction that is played twice in a row", () => {
    const twice = run([
      { type: "react", reactions: ["hop"] },
      { type: "react", reactions: ["hop"] },
    ]);
    const second = run([{ type: "reactionDone" }], twice);
    expect(displayState(second)).toBe("hop");
    expect(second.seq).not.toBe(twice.seq);
  });

  it("replays the reaction on screen when asked to repeat it", () => {
    const chewing = run([{ type: "react", reactions: ["munch"] }]);
    const again = run([{ type: "reactionRepeat" }], chewing);
    expect(displayState(again)).toBe("munch");
    expect(again.reactions).toEqual(["munch"]);
    expect(again.seq).not.toBe(chewing.seq);
    // Nothing on screen, nothing to repeat.
    expect(run([{ type: "reactionRepeat" }])).toBe(INITIAL_PET_MODEL);
  });

  it("drops reactions beyond the queue's limit", () => {
    const model = run(
      Array.from({ length: 6 }, () => ({
        type: "react" as const,
        reactions: ["hop" as const],
      })),
    );
    expect(model.reactions).toHaveLength(3);
  });

  it("wakes up and stops walking when something asks for its attention", () => {
    const asleep = run([{ type: "doze" }]);
    expect(displayState(asleep)).toBe("sleep");
    const poked = run([{ type: "react", reactions: ["hop"] }], asleep);
    expect(displayState(run([{ type: "reactionDone" }], poked))).toBe("idle");

    const walking = run([{ type: "wander", dir: 1 }]);
    const dragOver = run([{ type: "fileDrag", active: true }], walking);
    expect(displayState(dragOver)).toBe("mouthOpen");
    expect(
      displayState(run([{ type: "fileDrag", active: false }], dragOver)),
    ).toBe("idle");
  });

  it("works while a scan runs, and neither wanders nor dozes meanwhile", () => {
    const working = run([{ type: "working", active: true }]);
    expect(displayState(working)).toBe("work");
    expect(run([{ type: "wander", dir: 1 }], working).base).toBe("idle");
    expect(run([{ type: "doze" }], working).base).toBe("idle");
    // The window between asking for a scan and its first progress event.
    expect(displayState(INITIAL_PET_MODEL, true)).toBe("work");
    expect(isQuiet(INITIAL_PET_MODEL, true)).toBe(false);
  });

  it("shows a reaction over the app-driven poses", () => {
    const model = run([
      { type: "working", active: true },
      { type: "fileDrag", active: true },
      { type: "react", reactions: ["cheer"] },
    ]);
    expect(displayState(model)).toBe("cheer");
    expect(displayState(run([{ type: "reactionDone" }], model))).toBe(
      "mouthOpen",
    );
  });

  it("ignores reactions while it is in the air", () => {
    const held = run([{ type: "grab" }]);
    expect(run([{ type: "react", reactions: ["cheer"] }], held)).toBe(held);
  });

  it("lets nothing interrupt folding away", () => {
    const folding = run([
      { type: "react", reactions: ["cheer"] },
      { type: "react", reactions: ["fold"] },
    ]);
    expect(folding.reactions).toEqual(["fold"]);
    expect(run([{ type: "grab" }], folding)).toBe(folding);
    expect(run([{ type: "react", reactions: ["hop"] }], folding)).toBe(folding);
  });
});
