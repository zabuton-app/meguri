// Passes over the workspaces that a removal or quitting can stop: the
// workspace being removed is stopped and waited for, or skipped, and the rest
// are still done; on quit nothing goes on to another workspace.
import { describe, expect, it } from "vitest";
import { WorkspacePasses } from "../workspacePasses.js";

/** A step a test lets finish, or that ends early once aborted. */
function step(signal?: AbortSignal) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  signal?.addEventListener("abort", () => open());
  return { open, opened };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const two = () => [{ id: "a" }, { id: "b" }];

describe("WorkspacePasses", () => {
  it("runs each workspace in turn, skipping one no longer listed", async () => {
    const passes = new WorkspacePasses();
    let listed = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const ran: string[] = [];
    await passes.forEachWorkspace(
      () => listed,
      ({ id }) => {
        ran.push(id);
        // "b" goes while "a" runs.
        if (id === "a") listed = listed.filter((w) => w.id !== "b");
        return Promise.resolve();
      },
    );
    expect(ran).toEqual(["a", "c"]);
  });

  it("stops the workspace being removed, waits for it, and carries on", async () => {
    const passes = new WorkspacePasses();
    const ran: [string, boolean][] = [];
    const steps = new Map<string, ReturnType<typeof step>>();
    const pass = passes.forEachWorkspace(two, async ({ id }, signal) => {
      const s = step(signal);
      steps.set(id, s);
      await s.opened;
      ran.push([id, signal.aborted]);
    });
    // "a" is running: the removal stops it and runs once it has stopped.
    const removed = await passes.holding("a", () => {
      expect(ran).toEqual([["a", true]]);
      return Promise.resolve("removed");
    });
    expect(removed).toBe("removed");
    // The next one still runs, to the end.
    await settle();
    steps.get("b")?.open();
    await pass;
    expect(ran).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("skips a workspace held further down the list", async () => {
    const passes = new WorkspacePasses();
    const ran: string[] = [];
    const first = step();
    const pass = passes.forEachWorkspace(two, async ({ id }) => {
      ran.push(id);
      if (id === "a") await first.opened;
    });
    // "b" is removed while "a" runs: nothing to stop, and it is not reached.
    let removing = true;
    const removal = passes.holding("b", async () => {
      first.open();
      await pass;
      removing = false;
    });
    await removal;
    expect(removing).toBe(false);
    expect(ran).toEqual(["a"]);
    // Once removed and released, a later pass may reach it again (the same
    // path added back is the same id).
    await passes.forEachWorkspace(two, ({ id }) => {
      ran.push(id);
      return Promise.resolve();
    });
    expect(ran).toEqual(["a", "a", "b"]);
  });

  it("keeps going after a workspace's pass throws, and holds it no longer", async () => {
    const passes = new WorkspacePasses();
    await expect(
      passes.forEachWorkspace(two, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    // Nothing is left running: a removal does not wait.
    await expect(passes.holding("a", () => Promise.resolve(1))).resolves.toBe(
      1,
    );
  });

  it("stops every pass on quit, and starts none after", async () => {
    const passes = new WorkspacePasses();
    const ran: [string, boolean][] = [];
    const pass = passes.forEachWorkspace(two, async ({ id }, signal) => {
      await step(signal).opened;
      ran.push([id, signal.aborted]);
    });
    await passes.abortAll();
    // The pass is over: "a" was stopped, "b" never began.
    await pass;
    expect(ran).toEqual([["a", true]]);
    await passes.forEachWorkspace(two, ({ id }) => {
      ran.push([id, false]);
      return Promise.resolve();
    });
    expect(ran).toEqual([["a", true]]);
  });
});
