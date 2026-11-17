import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CRASH_REPORTS_KEPT,
  CrashSession,
  DUMP_GRACE_MS,
  LOG_TAIL_LINES,
  MAX_RECORDED_CRASHES,
  crashReportIssueUrl,
  deleteCrashReport,
  detectPreviousSession,
  listCrashReports,
  toCrashReportDto,
} from "../crashReports.js";

let dir: string;
let marker: string;
let dumps: string;
let reports: string;
let logFile: string;
const T0 = Date.UTC(2026, 10, 17, 9);
const versions = {
  version: "0.12.0",
  electron: "45.2.3",
  platform: "linux",
  osRelease: "6.0.0",
  arch: "x64",
  channel: "AUR (meguri-bin)",
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-crash-"));
  marker = path.join(dir, "session.json");
  dumps = path.join(dir, "Crashpad");
  reports = path.join(dir, "crash-reports");
  logFile = path.join(dir, "logs", "main.log");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeDump(name: string, at: number): void {
  const file = path.join(dumps, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "MDMP");
  fs.utimesSync(file, at / 1000, at / 1000);
}

const detect = (now = T0 + 60_000) =>
  detectPreviousSession({
    markerFile: marker,
    dumpsDir: dumps,
    logFile,
    reportsDir: reports,
    appName: "Meguri",
    now,
  });

describe("CrashSession", () => {
  it("removes the marker on a clean exit", () => {
    const s = new CrashSession(marker, versions);
    s.start(T0);
    expect(fs.existsSync(marker)).toBe(true);
    s.end();
    expect(fs.existsSync(marker)).toBe(false);
    expect(detect()).toBeNull();
  });

  it("keeps the marker for child crashes recorded before a clean exit", () => {
    const s = new CrashSession(marker, versions);
    s.start(T0);
    s.recordChildCrash({ process: "renderer", reason: "oom", at: T0 + 1000 });
    s.end();
    s.end();
    const report = detect();
    expect(report?.kind).toBe("crashed");
    expect(report?.text).toContain("renderer: oom");
    expect(report?.text).not.toContain("did not exit normally");
  });

  it("does nothing before start()", () => {
    const s = new CrashSession(marker, versions);
    s.recordChildCrash({ process: "GPU", reason: "crashed", at: T0 });
    s.end();
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe("detectPreviousSession", () => {
  it("returns nothing without a marker", () => {
    expect(detect()).toBeNull();
    expect(listCrashReports(reports)).toEqual([]);
  });

  it("reports an unclean exit without a dump, and removes the marker", () => {
    new CrashSession(marker, versions).start(T0);
    // A dump from an earlier run is not this one's.
    writeDump("completed/old.dmp", T0 - 1000);
    const report = detect();
    expect(report?.kind).toBe("unclean-exit");
    expect(report?.dumps).toEqual([]);
    expect(report?.text).toContain("Result: Did not exit normally");
    expect(report?.text).toContain("Version: 0.12.0");
    expect(report?.text).toContain("Installed from: AUR (meguri-bin)");
    expect(fs.existsSync(marker)).toBe(false);
    expect(listCrashReports(reports).map((r) => r.id)).toEqual([report?.id]);
  });

  it("takes a dump after the start for a main process crash", () => {
    new CrashSession(marker, versions).start(T0);
    writeDump(path.join("completed", "a.dmp"), T0 + 5000);
    const report = detect();
    expect(report?.kind).toBe("crashed");
    expect(report?.text).toContain("Result: Crashed (main)");
    expect(report?.dumps).toEqual([path.join("completed", "a.dmp")]);
  });

  it("does not take a recorded child crash's dump for the main process's", () => {
    const s = new CrashSession(marker, versions);
    s.start(T0);
    s.recordChildCrash({ process: "GPU", reason: "crashed", at: T0 + 1000 });
    writeDump("a.dmp", T0 + 2000);
    expect(detect()?.text).toContain("Result: Crashed (GPU)");
  });

  it("takes a dump well after the last child crash for the main process's", () => {
    const s = new CrashSession(marker, versions);
    s.start(T0);
    s.recordChildCrash({ process: "GPU", reason: "crashed", at: T0 + 1000 });
    writeDump("a.dmp", T0 + 2000);
    writeDump("b.dmp", T0 + 1000 + DUMP_GRACE_MS + 1);
    expect(detect()?.text).toContain("Result: Crashed (GPU, main)");
  });

  it("quotes the last lines of the log", () => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
    fs.writeFileSync(logFile, lines.join("\n") + "\n");
    new CrashSession(marker, versions).start(T0);
    const text = detect()?.text ?? "";
    expect(text).toContain(`line ${150 - LOG_TAIL_LINES}\n`);
    expect(text).not.toContain(`line ${149 - LOG_TAIL_LINES}\n`);
    expect(text.endsWith("line 149")).toBe(true);
  });

  it("keeps the newest child crashes, so their dumps are not the main process's", () => {
    const s = new CrashSession(marker, versions);
    s.start(T0);
    const n = MAX_RECORDED_CRASHES + 5;
    for (let i = 0; i < n; i++) {
      s.recordChildCrash({
        process: "GPU",
        reason: "crashed",
        at: T0 + i * DUMP_GRACE_MS * 2,
      });
    }
    writeDump("last.dmp", T0 + (n - 1) * DUMP_GRACE_MS * 2 + 1000);
    const text = detect(T0 + n * DUMP_GRACE_MS * 2)?.text ?? "";
    expect(text).toContain("Result: Crashed (GPU)");
    expect(text.match(/GPU: crashed/g)).toHaveLength(MAX_RECORDED_CRASHES);
  });

  it("reports a marker it cannot read as a run that did not exit normally", () => {
    // A power loss can leave the marker written just before it empty.
    fs.writeFileSync(marker, "");
    fs.utimesSync(marker, T0 / 1000, T0 / 1000);
    writeDump("before.dmp", T0 - 1000);
    const report = detect();
    expect(report?.kind).toBe("unclean-exit");
    expect(report?.text).toContain("Version: unknown");
    expect(report?.dumps).toEqual([]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("reads a marker whose crashes are malformed as unknown, and removes it", () => {
    fs.writeFileSync(
      marker,
      JSON.stringify({ ...versions, startedAt: 1, crashes: [{}] }),
    );
    expect(detect()?.text).toContain("Version: unknown");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("does not take a dump after a clean exit for a main process crash", () => {
    const s = new CrashSession(marker, versions);
    s.start(T0);
    s.recordChildCrash({ process: "renderer", reason: "oom", at: T0 + 1000 });
    s.end();
    writeDump("later.dmp", T0 + 1000 + DUMP_GRACE_MS * 3);
    expect(detect()?.text).toContain("Result: Crashed (renderer)");
  });

  it("drops the cut first line of a long log", () => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const long = "x".repeat(200);
    const lines = Array.from({ length: 1000 }, (_, i) => `${i} ${long}`);
    fs.writeFileSync(logFile, lines.join("\n"));
    new CrashSession(marker, versions).start(T0);
    const tail = (detect()?.text ?? "").split("main.log:\n")[1] ?? "";
    const got = tail.split("\n");
    expect(got).toHaveLength(LOG_TAIL_LINES);
    expect(got.every((l) => l.endsWith(long) && /^\d+ x/.test(l))).toBe(true);
    expect(got.at(-1)).toBe(`999 ${long}`);
  });

  it("keeps only the newest reports and dumps", () => {
    for (let i = 0; i < CRASH_REPORTS_KEPT + 2; i++) {
      new CrashSession(marker, versions).start(T0 + i * 1000);
      writeDump(`d${i}.dmp`, T0 + i * 1000 + 500);
      detect(T0 + 100_000 + i);
    }
    const kept = listCrashReports(reports);
    expect(kept).toHaveLength(CRASH_REPORTS_KEPT);
    expect(kept[0]?.detectedAt).toBe(T0 + 100_000 + CRASH_REPORTS_KEPT + 1);
    const left = fs.readdirSync(dumps).sort();
    expect(left).toHaveLength(CRASH_REPORTS_KEPT);
    expect(left).not.toContain("d0.dmp");
    expect(left).not.toContain("d1.dmp");
  });
});

describe("deleteCrashReport", () => {
  it("deletes the report and its run's dumps", () => {
    new CrashSession(marker, versions).start(T0);
    writeDump("a.dmp", T0 + 1000);
    writeDump("other.dmp", T0 - 1000);
    const report = detect();
    deleteCrashReport(reports, dumps, report?.id ?? "");
    expect(listCrashReports(reports)).toEqual([]);
    expect(fs.readdirSync(dumps)).toEqual(["other.dmp"]);
  });

  it("skips a report whose dumps are not names", () => {
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(
      path.join(reports, "1.json"),
      JSON.stringify({ id: "1", detectedAt: 1, text: "", dumps: [42] }),
    );
    expect(listCrashReports(reports)).toEqual([]);
  });

  it("refuses an id that is not one", () => {
    expect(() => deleteCrashReport(reports, dumps, "../x")).toThrow();
  });

  it("never removes a file outside the dumps folder", () => {
    const outside = path.join(dir, "keep.dmp");
    fs.writeFileSync(outside, "x");
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(
      path.join(reports, "1.json"),
      JSON.stringify({
        id: "1",
        detectedAt: 1,
        text: "",
        dumps: ["../keep.dmp"],
      }),
    );
    deleteCrashReport(reports, dumps, "1");
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe("crashReportIssueUrl", () => {
  it("fills in the version, OS and channel", () => {
    new CrashSession(marker, versions).start(T0);
    const report = detect();
    if (!report) throw new Error("no report");
    const url = new URL(
      crashReportIssueUrl(
        {
          repo: { owner: "zabuton-app", name: "meguri" },
          template: "crash_report.yml",
        },
        report,
      ),
    );
    expect(url.pathname).toBe("/zabuton-app/meguri/issues/new");
    expect(url.searchParams.get("template")).toBe("crash_report.yml");
    expect(url.searchParams.get("version")).toBe("0.12.0");
    expect(url.searchParams.get("os")).toBe("Linux");
    expect(url.searchParams.get("channel")).toBe("AUR (meguri-bin)");
  });
});

describe("toCrashReportDto", () => {
  it("has no issue URL for an app without a crash report form", () => {
    new CrashSession(marker, versions).start(T0);
    const report = detect();
    if (!report) throw new Error("no report");
    const dto = toCrashReportDto(report, null, report.id);
    expect(dto.issueUrl).toBeNull();
    expect(dto.isNew).toBe(true);
  });
});
