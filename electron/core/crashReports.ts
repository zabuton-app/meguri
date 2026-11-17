// Crash reports: tell, at the next launch, that the previous run ended
// abnormally, and keep a plain-text report the user can copy (#544).
//
// Electron's crashReporter writes minidumps (uploadToServer: false, nothing
// is sent anywhere), but neither it nor the OS tells the next launch that the
// previous run failed. So each run leaves a marker, <userData>/session.json,
// that a clean exit removes:
//   - the marker is left and a dump is newer than the last crash the run
//     recorded itself: the main process crashed
//   - the marker is left and there is no such dump: the run did not exit
//     normally (forced quit, power loss)
//   - a child process (renderer, GPU, utility) that crashed is recorded in the
//     marker while the run goes on, so a crash the app recovered from (a
//     renderer reloaded in place) is reported at the next launch too, even
//     after a clean exit
// startCrashReports() wires it up at startup. The report is stored as JSON in
// <userData>/crash-reports. The dumps stay where Crashpad put them and are
// never part of the report: they hold part of the process memory.
import { app, crashReporter } from "electron";
import fs from "node:fs";
import path from "node:path";
import { logFilePath, scopedLog } from "./logger.js";
import type { CrashReport } from "../../shared/ipc/schema.js";

const log = scopedLog("crash");

/** Reports and dumps kept; older ones are deleted at each launch. */
export const CRASH_REPORTS_KEPT = 5;
/** Lines of main.log in a report. */
export const LOG_TAIL_LINES = 100;
/** How far back main.log is read for those lines. */
const LOG_TAIL_BYTES = 64 * 1024;
/**
 * A child process's dump can land a little after its crash is recorded
 * (Crashpad writes it from its own process). A dump later than the last
 * recorded crash by more than this is taken for the main process's.
 */
export const DUMP_GRACE_MS = 10_000;
/** A renderer that crashes over and over must not grow the marker forever. */
export const MAX_RECORDED_CRASHES = 20;

/** A child process that went away abnormally while the run went on. */
export interface RecordedCrash {
  /** "renderer", or Electron's child process type ("GPU", "Utility"…). */
  process: string;
  /** Electron's reason ("crashed", "oom"…) and exit code. */
  reason: string;
  /** Unix ms. */
  at: number;
}

/**
 * What a report says about the run: taken when it starts, so an update of
 * the app or the OS before the next launch does not change it.
 */
export interface RunInfo {
  version: string;
  electron: string;
  /** "linux", "win32", "darwin" (process.platform). */
  platform: string;
  /** os.release(). */
  osRelease: string;
  arch: string;
  /** installChannel(). */
  channel: string;
}

/** The marker one run leaves in session.json. */
interface SessionMarker extends RunInfo {
  startedAt: number;
  crashes: RecordedCrash[];
  /** The run exited cleanly, but recorded child crashes to report. */
  exitedCleanly?: boolean;
}

/** A report as stored in <reportsDir>/<id>.json. */
export interface StoredCrashReport {
  id: string;
  /** When the next launch found it (Unix ms). */
  detectedAt: number;
  kind: "crashed" | "unclean-exit";
  /** The crashed run's version, and the details the issue form is filled
   *  in with. */
  version: string;
  platform: string;
  channel: string;
  /** The dumps of that run, relative to the dumps folder. */
  dumps: string[];
  text: string;
}

/** Report ids are the detection time in ms: digits only, so safe in paths. */
const ID_RE = /^\d+$/;

/**
 * One run's marker. start() writes it, the crash handlers record child
 * crashes in it, end() removes it on a clean exit.
 */
export class CrashSession {
  private marker: SessionMarker | null = null;

  constructor(
    private readonly file: string,
    private readonly run: RunInfo,
  ) {}

  start(now = Date.now()): void {
    this.marker = { ...this.run, startedAt: now, crashes: [] };
    this.write();
  }

  recordChildCrash(crash: RecordedCrash): void {
    if (!this.marker || this.marker.exitedCleanly) return;
    // The newest are kept: the last one's time tells a child's dump from the
    // main process's (buildReport).
    this.marker.crashes.push(crash);
    if (this.marker.crashes.length > MAX_RECORDED_CRASHES) {
      this.marker.crashes.shift();
    }
    this.write();
  }

  /** A clean exit. Idempotent: every quit path calls it. */
  end(): void {
    if (!this.marker || this.marker.exitedCleanly) return;
    if (this.marker.crashes.length === 0) {
      this.marker = null;
      try {
        fs.rmSync(this.file, { force: true });
      } catch (e) {
        log.warn("could not remove the session marker:", e);
      }
      return;
    }
    this.marker.exitedCleanly = true;
    this.write();
  }

  private write(): void {
    // Through a temporary file: a crash mid-write must not leave a marker
    // the next launch cannot read.
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.marker));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      log.warn("could not write the session marker:", e);
    }
  }
}

interface Dump {
  /** Relative to the dumps folder. */
  name: string;
  mtimeMs: number;
}

/** Every minidump under the dumps folder (Crashpad keeps them in subfolders). */
function listDumps(dumpsDir: string): Dump[] {
  let names: string[];
  try {
    names = fs.readdirSync(dumpsDir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!name.endsWith(".dmp")) return [];
    try {
      const st = fs.statSync(path.join(dumpsDir, name));
      return st.isFile() ? [{ name, mtimeMs: st.mtimeMs }] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The last lines of the log. The logger redacts paths under the home
 * directory; others (a library on another drive) are left until #543.
 */
function logTail(logFile: string): string {
  let fd: number;
  try {
    fd = fs.openSync(logFile, "r");
  } catch {
    return "";
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString("utf8").split(/\r?\n/);
    // The first line may be cut, unless the read began at the file's start.
    if (length < size) lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-LOG_TAIL_LINES).join("\n");
  } catch {
    return "";
  } finally {
    fs.closeSync(fd);
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const isTime = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function isMarker(m: unknown): m is SessionMarker {
  if (typeof m !== "object" || m === null) return false;
  const r = m as Record<string, unknown>;
  return (
    ["version", "electron", "platform", "osRelease", "arch", "channel"].every(
      (k) => isString(r[k]),
    ) &&
    isTime(r["startedAt"]) &&
    Array.isArray(r["crashes"]) &&
    r["crashes"].every(
      (c: unknown) =>
        typeof c === "object" &&
        c !== null &&
        isString((c as RecordedCrash).process) &&
        isString((c as RecordedCrash).reason) &&
        isTime((c as RecordedCrash).at),
    )
  );
}

/**
 * The marker the previous run left, or null when it left none. One that
 * cannot be read still says the run did not end cleanly (a power loss can
 * leave a file written just before it empty): it is read as a run started
 * when the file was last written, of which nothing else is known.
 */
function readMarker(file: string): SessionMarker | null {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = fs.readFileSync(file, "utf8");
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  try {
    const m: unknown = JSON.parse(raw);
    if (isMarker(m)) return m;
  } catch {
    /* read as unknown below */
  }
  log.warn("the previous session marker could not be read");
  return {
    version: "unknown",
    electron: "unknown",
    platform: "unknown",
    osRelease: "unknown",
    arch: "unknown",
    channel: "unknown",
    startedAt: mtimeMs,
    crashes: [],
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Look at the marker the previous run left, if any, and turn it into a stored
 * report. Removes the marker, so call it once, before CrashSession.start(),
 * and before this run writes to the log (the tail is the previous run's).
 * Also deletes all but the newest reports and dumps.
 */
export function detectPreviousSession(opts: {
  markerFile: string;
  dumpsDir: string;
  logFile: string;
  reportsDir: string;
  appName: string;
  now?: number;
}): StoredCrashReport | null {
  const now = opts.now ?? Date.now();
  const dumps = listDumps(opts.dumpsDir);
  let report: StoredCrashReport | null;
  try {
    const marker = readMarker(opts.markerFile);
    report = marker ? buildReport(marker, { ...opts, dumps }, now) : null;
  } finally {
    // Even if reading it failed: a marker that stays would fail every launch.
    try {
      fs.rmSync(opts.markerFile, { force: true });
    } catch (e) {
      log.warn("could not remove the previous session marker:", e);
    }
  }
  if (report) {
    try {
      fs.mkdirSync(opts.reportsDir, { recursive: true });
      fs.writeFileSync(
        path.join(opts.reportsDir, `${report.id}.json`),
        JSON.stringify(report),
      );
    } catch (e) {
      log.warn("could not store the crash report:", e);
    }
  }
  pruneCrashReports(opts.reportsDir, opts.dumpsDir, dumps);
  return report;
}

function buildReport(
  marker: SessionMarker,
  opts: { dumps: Dump[]; logFile: string; appName: string },
  now: number,
): StoredCrashReport | null {
  // A clean exit leaves a marker only for the child crashes it recorded.
  if (marker.exitedCleanly && marker.crashes.length === 0) return null;
  const dumps = opts.dumps.filter(
    (d) => d.mtimeMs >= marker.startedAt && d.mtimeMs <= now,
  );
  const lastRecorded = Math.max(...marker.crashes.map((c) => c.at));
  // Dumps of the recorded child crashes land near them; one after the last
  // of them can only be the main process's.
  const mainDump = marker.exitedCleanly
    ? undefined
    : dumps
        .filter((d) =>
          marker.crashes.length === 0
            ? true
            : d.mtimeMs > lastRecorded + DUMP_GRACE_MS,
        )
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  const crashes: RecordedCrash[] = [...marker.crashes];
  if (mainDump) {
    crashes.push({ process: "main", reason: "crashed", at: mainDump.mtimeMs });
  }
  crashes.sort((a, b) => a.at - b.at);
  const kind = crashes.length > 0 ? "crashed" : "unclean-exit";

  const result =
    kind === "crashed"
      ? `Crashed (${[...new Set(crashes.map((c) => c.process))].join(", ")})`
      : "Did not exit normally";
  const lines = [
    `${opts.appName} crash report`,
    "",
    `Result: ${result}`,
    `Version: ${marker.version}`,
    `Electron: ${marker.electron}`,
    `OS: ${marker.platform} ${marker.osRelease} (${marker.arch})`,
    `Installed from: ${marker.channel}`,
    `Session started: ${iso(marker.startedAt)}`,
  ];
  if (crashes.length > 0) {
    lines.push("", "Crashes:");
    for (const c of crashes) {
      lines.push(`- ${iso(c.at)} ${c.process}: ${c.reason}`);
    }
  }
  if (!marker.exitedCleanly) {
    lines.push("", "The session did not exit normally.");
  }
  const tail = logTail(opts.logFile);
  lines.push(
    "",
    `Last ${LOG_TAIL_LINES} lines of main.log:`,
    tail || "(empty)",
  );

  return {
    id: String(now),
    detectedAt: now,
    kind,
    version: marker.version,
    platform: marker.platform,
    channel: marker.channel,
    dumps: dumps.map((d) => d.name),
    text: lines.join("\n"),
  };
}

function readReport(file: string): StoredCrashReport | null {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8")) as StoredCrashReport;
    if (
      typeof r.id !== "string" ||
      !ID_RE.test(r.id) ||
      typeof r.detectedAt !== "number" ||
      typeof r.text !== "string" ||
      !Array.isArray(r.dumps) ||
      !r.dumps.every((d) => typeof d === "string")
    ) {
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

/** The stored reports, newest first. */
export function listCrashReports(reportsDir: string): StoredCrashReport[] {
  let names: string[];
  try {
    names = fs.readdirSync(reportsDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .flatMap((n) => readReport(path.join(reportsDir, n)) ?? [])
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

/** Delete a report and the dumps of its run. */
export function deleteCrashReport(
  reportsDir: string,
  dumpsDir: string,
  id: string,
): void {
  if (!ID_RE.test(id)) throw new Error("invalid crash report id");
  const file = path.join(reportsDir, `${id}.json`);
  const report = readReport(file);
  for (const name of report?.dumps ?? []) removeDump(dumpsDir, name);
  fs.rmSync(file, { force: true });
}

/** Remove one dump, only if the name really is inside the dumps folder. */
function removeDump(dumpsDir: string, name: string): void {
  const abs = path.resolve(dumpsDir, name);
  if (!abs.startsWith(path.resolve(dumpsDir) + path.sep)) return;
  if (!abs.endsWith(".dmp")) return;
  try {
    fs.rmSync(abs, { force: true });
  } catch (e) {
    log.warn("could not remove a crash dump:", e);
  }
}

/** Keep the newest CRASH_REPORTS_KEPT reports and dumps. */
function pruneCrashReports(
  reportsDir: string,
  dumpsDir: string,
  all: Dump[],
): void {
  for (const r of listCrashReports(reportsDir).slice(CRASH_REPORTS_KEPT)) {
    try {
      fs.rmSync(path.join(reportsDir, `${r.id}.json`), { force: true });
    } catch (e) {
      log.warn("could not remove an old crash report:", e);
    }
  }
  const dumps = [...all].sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const d of dumps.slice(CRASH_REPORTS_KEPT)) removeDump(dumpsDir, d.name);
}

/** The OS as the issue forms name it. */
function osName(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
}

/** The issue form a crash report is filed with (AppOptions.crashReportForm). */
export interface CrashIssueForm {
  repo: { owner: string; name: string };
  /** The form's file name under .github/ISSUE_TEMPLATE/ in that repository. */
  template: string;
}

/**
 * The new crash report issue on GitHub, with the version, OS and channel
 * filled in. The report itself is pasted from the clipboard: it would make
 * the URL too long, and the user sees what they share.
 */
export function crashReportIssueUrl(
  form: CrashIssueForm,
  report: StoredCrashReport,
): string {
  const { repo } = form;
  const params = new URLSearchParams({
    template: form.template,
    version: report.version,
    os: osName(report.platform),
    channel: report.channel,
  });
  return `https://github.com/${repo.owner}/${repo.name}/issues/new?${params.toString()}`;
}

/** A stored report as the renderer gets it. */
export function toCrashReportDto(
  report: StoredCrashReport,
  form: CrashIssueForm | null,
  newId: string | null,
): CrashReport {
  return {
    id: report.id,
    detectedAt: report.detectedAt,
    kind: report.kind,
    text: report.text,
    issueUrl: form ? crashReportIssueUrl(form, report) : null,
    isNew: report.id === newId,
  };
}

/** What startCrashReports() sets up, for the quit paths and the IPC. */
export interface CrashReports {
  /** This run's marker. A no-op one when crash reports are off. */
  session: CrashSession;
  reportsDir: string;
  dumpsDir: string;
  /** The report found at this launch, if any. */
  newReportId: string | null;
}

/**
 * Start collecting dumps, turn the marker the previous run left into a
 * report, and leave this run's marker, in that order. Call once at startup,
 * after the single-instance lock (a second instance must not take the
 * running one's marker) and before this run writes to the log (the report
 * quotes the previous run's).
 */
export function startCrashReports(opts: {
  enabled: boolean;
  appName: string;
  run: RunInfo;
}): CrashReports {
  const userData = app.getPath("userData");
  const markerFile = path.join(userData, "session.json");
  const reportsDir = path.join(userData, "crash-reports");
  const dumpsDir = app.getPath("crashDumps");
  const session = new CrashSession(markerFile, opts.run);
  if (!opts.enabled) {
    return { session, reportsDir, dumpsDir, newReportId: null };
  }
  // Minidumps of every process go to the dumps folder and are never sent
  // anywhere. ignoreSystemCrashHandler stays false, so a crash of the main
  // process still reaches the OS (and the Store's reports).
  crashReporter.start({
    uploadToServer: false,
    globalExtra: { channel: opts.run.channel },
  });
  let newReportId: string | null = null;
  try {
    newReportId =
      detectPreviousSession({
        markerFile,
        dumpsDir,
        logFile: logFilePath(),
        reportsDir,
        appName: opts.appName,
      })?.id ?? null;
  } catch (e) {
    // A report is not worth failing the launch over.
    log.error("could not look at the previous session:", e);
  }
  session.start();
  return { session, reportsDir, dumpsDir, newReportId };
}
