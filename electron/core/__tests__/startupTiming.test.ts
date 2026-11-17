// The startup line (#558): only this app's marks, counted from the origin it
// is given, so the renderer's line counts from main's start like main's own.
import { describe, expect, it } from "vitest";
import {
  formatStartupLine,
  startupMarks,
} from "../../../shared/startupTiming.js";

function fakePerf(timeOrigin: number, marks: [string, number][]) {
  return {
    timeOrigin,
    getEntriesByType: () =>
      marks.map(([name, startTime]) => ({ name, startTime })) as never,
  };
}

describe("startupMarks", () => {
  it("keeps only the startup marks, without their prefix", () => {
    const perf = fakePerf(1000, [
      ["startup:ready", 200.4],
      ["react:render", 250],
      ["startup:window", 300.6],
    ]);
    expect(startupMarks(perf, 1000)).toEqual([
      { name: "ready", ms: 200 },
      { name: "window", ms: 301 },
    ]);
  });

  it("counts from the given origin, not this process's own", () => {
    // A renderer that started 500ms after main.
    const perf = fakePerf(1500, [["startup:script", 40]]);
    expect(startupMarks(perf, 1000)).toEqual([{ name: "script", ms: 540 }]);
  });
});

describe("formatStartupLine", () => {
  it("says how startup ended, then lists each step with its time", () => {
    expect(
      formatStartupLine("main", "failed", [
        { name: "ready", ms: 200 },
        { name: "media server", ms: 260 },
      ]),
    ).toBe(
      "[startup] main (failed, since process start): ready 200ms, media server 260ms",
    );
  });
});
