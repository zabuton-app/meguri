// The auto-tagging screen's rollback handles: bounded, but never at the cost
// of the apply still under way.
import { describe, expect, it } from "vitest";
import { UndoLog, type UndoEntry } from "../../ipc/undoLog.js";

const entry = (pairs: number): UndoEntry => [
  {
    workspaceId: "ws",
    pairs: Array.from({ length: pairs }, (_, i) => [`k${i}`, i]),
  },
];

describe("UndoLog", () => {
  it("lets the oldest handles go past its bounds", () => {
    const log = new UndoLog(2, 10);
    log.add("a", entry(1));
    log.add("b", entry(1));
    log.add("c", entry(1));
    expect(log.forget("a")).toBeUndefined();
    // Over the pairs too: only as many go as it takes.
    log.add("d", entry(9));
    expect(log.forget("b")).toBeUndefined();
    expect(log.forget("c")).toEqual(entry(1));
    expect(log.forget("d")).toEqual(entry(9));
  });

  it("keeps the earlier calls of the apply under way, past its bounds", () => {
    const log = new UndoLog(2, 10);
    log.add("old", entry(1));
    log.add("first", entry(6));
    log.add("second", entry(6), ["first"]);
    // The older handle went; the apply's own stay, to be taken back together.
    expect(log.forget("old")).toBeUndefined();
    expect(log.forget("first")).toEqual(entry(6));
    expect(log.forget("second")).toEqual(entry(6));
  });
});
