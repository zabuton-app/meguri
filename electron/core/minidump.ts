// A minimal minidump reader for crash reports (#545): where a crash happened,
// as text that can be pasted into a public issue.
//
// It reads only the header and stream directory, the system info (OS and
// CPU), the exception stream (code, address, crashing thread, and from its
// thread context the instruction pointer only), the thread names, the module
// list (name, version, build ID / debug ID) and the Crashpad annotations. It
// never reads the memory streams, and the text it makes holds no memory
// contents and no directories.
//
// scripts/dev/crash-fixture.mjs loads this file with Node's type stripping:
// no relative imports (they would not resolve to .ts), and only TypeScript
// that stripping can erase (no parameter properties, enums or namespaces).
//
// Format references: Microsoft's minidumpapiset.h, and Crashpad's
// minidump_extensions.h for the Crashpad info stream.
import fs from "node:fs";
import path from "node:path";

/** Reads `length` bytes at `offset`; throws MinidumpError past the end. */
export type ReadAt = (offset: number, length: number) => Buffer;

export class MinidumpError extends Error {}

export type MinidumpOs = "windows" | "macos" | "linux" | "other";

export interface MinidumpModule {
  /** The file name, without its directory. */
  name: string;
  /** The full path, as the dump has it. Never part of a summary. */
  path: string;
  base: bigint;
  size: number;
  /** "1.2.3.4" from the version resource, when the module has one. */
  version: string | null;
  /** ELF build ID (Linux), as hex. */
  buildId: string | null;
  /** Breakpad debug ID (GUID and age) from a PDB 7.0 record (Windows, macOS). */
  debugId: string | null;
  /** Windows code ID: time stamp and image size. */
  codeId: string | null;
}

export interface Minidump {
  os: MinidumpOs;
  exception: {
    code: number;
    /** Linux: si_code; macOS: the first Mach exception code. */
    flags: number;
    address: bigint;
    threadId: number;
    threadName: string | null;
  } | null;
  /** The instruction pointer of the crashing thread. */
  pc: bigint | null;
  modules: MinidumpModule[];
  /** The process-wide simple annotations (Electron's globalExtra among them). */
  annotations: Record<string, string>;
  /**
   * The string annotations of the modules (Chromium's crash keys). They can
   * hold paths and URLs: a summary quotes only ptype from them.
   */
  moduleAnnotations: Record<string, string>;
}

const SIGNATURE = 0x504d444d; // "MDMP"
const VERSION = 0xa793;

const MODULE_LIST_STREAM = 4;
const EXCEPTION_STREAM = 6;
const SYSTEM_INFO_STREAM = 7;
const THREAD_NAMES_STREAM = 24;
const CRASHPAD_INFO_STREAM = 0x43500001;

const CV_PDB70 = 0x53445352; // "RSDS"
const CV_ELF = 0x4270454c; // "BpEL"
const VS_FFI_SIGNATURE = 0xfeef04bd;

/** Upper bounds that keep a corrupt count or length from reading on and on. */
const MAX_ENTRIES = 4096;
const MAX_STRING_BYTES = 64 * 1024;
const MAX_CV_BYTES = 4096;
/**
 * What one dump may read in all. The bounds above are per list, and lists
 * can point at the same entries over and over (4096 module links, each to a
 * dictionary of 4096 entries): without this a corrupt dump could hold up the
 * launch for minutes. A real dump reads about 4,000 times, 300 KB at most.
 */
const MAX_READS = 50_000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

const MODULE_SIZE = 108;

/** Byte offset of the instruction pointer in each CPU's thread context. */
const PC_OFFSET: Record<number, { offset: number; size: 4 | 8 }> = {
  0: { offset: 0xb8, size: 4 }, // x86: Eip
  9: { offset: 0xf8, size: 8 }, // AMD64: Rip
  12: { offset: 0x108, size: 8 }, // ARM64: Pc
};

const OS_BY_PLATFORM_ID: Record<number, MinidumpOs> = {
  2: "windows", // VER_PLATFORM_WIN32_NT
  0x8101: "macos",
  0x8201: "linux",
};

interface Location {
  size: number;
  rva: number;
}

/**
 * Control characters as "?": a string in a dump goes into the report as is,
 * and a line break there could pass for a line of the report.
 */
const printable = (s: string): string => s.replace(/\p{Cc}/gu, "?");

class Reader {
  private readonly readAt: ReadAt;
  private reads = 0;
  private readBytes = 0;

  constructor(readAt: ReadAt) {
    this.readAt = readAt;
  }

  bytes(offset: number, length: number): Buffer {
    this.reads += 1;
    this.readBytes += length;
    if (this.reads > MAX_READS || this.readBytes > MAX_READ_BYTES) {
      throw new MinidumpError("too large");
    }
    return this.readAt(offset, length);
  }
  u16(offset: number): number {
    return this.bytes(offset, 2).readUInt16LE(0);
  }
  u32(offset: number): number {
    return this.bytes(offset, 4).readUInt32LE(0);
  }
  u64(offset: number): bigint {
    return this.bytes(offset, 8).readBigUInt64LE(0);
  }
  location(offset: number): Location {
    const b = this.bytes(offset, 8);
    return { size: b.readUInt32LE(0), rva: b.readUInt32LE(4) };
  }
  count(offset: number): number {
    const n = this.u32(offset);
    if (n > MAX_ENTRIES) throw new MinidumpError(`too many entries (${n})`);
    return n;
  }
  /** MINIDUMP_STRING: a byte length, then UTF-16LE. */
  utf16(rva: number): string {
    const length = this.u32(rva);
    if (length > MAX_STRING_BYTES || length % 2 !== 0) {
      throw new MinidumpError("invalid string");
    }
    return printable(this.bytes(rva + 4, length).toString("utf16le"));
  }
  /** Crashpad's MinidumpUTF8String and MinidumpByteArray: a length, then bytes. */
  utf8(rva: number): string {
    const length = this.u32(rva);
    if (length > MAX_STRING_BYTES) throw new MinidumpError("invalid string");
    return printable(this.bytes(rva + 4, length).toString("utf8"));
  }
}

/** Read a minidump. Throws MinidumpError (or a read error) if it cannot. */
export function readMinidump(readAt: ReadAt): Minidump {
  const r = new Reader(readAt);
  if (r.u32(0) !== SIGNATURE || (r.u32(4) & 0xffff) !== VERSION) {
    throw new MinidumpError("not a minidump");
  }
  const streamCount = r.count(8);
  const directory = r.u32(12);
  const streams = new Map<number, Location>();
  for (let i = 0; i < streamCount; i++) {
    const at = directory + 12 * i;
    const type = r.u32(at);
    // The first of a type wins, as in other readers.
    if (!streams.has(type)) streams.set(type, r.location(at + 4));
  }

  const systemInfo = streams.get(SYSTEM_INFO_STREAM);
  const cpu = systemInfo ? r.u16(systemInfo.rva) : null;
  const os = systemInfo
    ? (OS_BY_PLATFORM_ID[r.u32(systemInfo.rva + 20)] ?? "other")
    : "other";

  let exception: Minidump["exception"] = null;
  let pc: bigint | null = null;
  const ex = streams.get(EXCEPTION_STREAM);
  if (ex) {
    const threadId = r.u32(ex.rva);
    exception = {
      code: r.u32(ex.rva + 8),
      flags: r.u32(ex.rva + 12),
      address: r.u64(ex.rva + 24),
      threadId,
      threadName: threadName(r, streams.get(THREAD_NAMES_STREAM), threadId),
    };
    const context = r.location(ex.rva + 160);
    const at = cpu === null ? undefined : PC_OFFSET[cpu];
    if (at && context.size >= at.offset + at.size) {
      pc =
        at.size === 8
          ? r.u64(context.rva + at.offset)
          : BigInt(r.u32(context.rva + at.offset));
    }
  }

  const moduleList = streams.get(MODULE_LIST_STREAM);
  const modules = moduleList ? readModules(r, moduleList, os) : [];
  const { annotations, moduleAnnotations } = readCrashpadInfo(
    r,
    streams.get(CRASHPAD_INFO_STREAM),
  );
  return { os, exception, pc, modules, annotations, moduleAnnotations };
}

function threadName(
  r: Reader,
  stream: Location | undefined,
  threadId: number,
): string | null {
  if (!stream) return null;
  const n = r.count(stream.rva);
  if (4 + n * 12 > stream.size) {
    throw new MinidumpError("thread names larger than their stream");
  }
  for (let i = 0; i < n; i++) {
    // MINIDUMP_THREAD_NAME: ThreadId, then a 64-bit RVA, packed in 12 bytes.
    const at = stream.rva + 4 + 12 * i;
    if (r.u32(at) !== threadId) continue;
    const rva = r.u64(at + 4);
    return rva > 0n && rva <= 0xffffffffn ? r.utf16(Number(rva)) : null;
  }
  return null;
}

const hex = (n: number, width: number): string =>
  n.toString(16).toUpperCase().padStart(width, "0");

function readModules(
  r: Reader,
  stream: Location,
  os: MinidumpOs,
): MinidumpModule[] {
  const n = r.count(stream.rva);
  if (4 + n * MODULE_SIZE > stream.size) {
    throw new MinidumpError("module list larger than its stream");
  }
  const modules: MinidumpModule[] = [];
  for (let i = 0; i < n; i++) {
    const at = stream.rva + 4 + MODULE_SIZE * i;
    const m = r.bytes(at, MODULE_SIZE);
    const size = m.readUInt32LE(8);
    const timeStamp = m.readUInt32LE(16);
    const version =
      m.readUInt32LE(24) === VS_FFI_SIGNATURE
        ? fileVersion(m.readUInt32LE(32), m.readUInt32LE(36))
        : null;
    const cv: Location = { size: m.readUInt32LE(76), rva: m.readUInt32LE(80) };
    const ids = codeView(r, cv);
    const file = r.utf16(m.readUInt32LE(20));
    modules.push({
      // path.win32 splits at "/" and backslash alike.
      name: path.win32.basename(file),
      path: file,
      base: m.readBigUInt64LE(0),
      size,
      version,
      ...ids,
      codeId:
        os === "windows" && timeStamp !== 0
          ? hex(timeStamp, 8) + size.toString(16)
          : null,
    });
  }
  return modules;
}

function fileVersion(ms: number, ls: number): string | null {
  if (ms === 0 && ls === 0) return null;
  return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join(".");
}

function codeView(
  r: Reader,
  cv: Location,
): Pick<MinidumpModule, "buildId" | "debugId"> {
  if (cv.size < 4 || cv.size > MAX_CV_BYTES) {
    return { buildId: null, debugId: null };
  }
  const b = r.bytes(cv.rva, cv.size);
  const signature = b.readUInt32LE(0);
  if (signature === CV_ELF && cv.size > 4) {
    return { buildId: b.toString("hex", 4), debugId: null };
  }
  if (signature === CV_PDB70 && cv.size >= 24) {
    // GUID (Data1, Data2, Data3 little-endian, then 8 bytes) and age, as
    // Breakpad and symbol servers write it.
    const debugId =
      hex(b.readUInt32LE(4), 8) +
      hex(b.readUInt16LE(8), 4) +
      hex(b.readUInt16LE(10), 4) +
      b.toString("hex", 12, 20).toUpperCase() +
      b.readUInt32LE(20).toString(16);
    return { buildId: null, debugId };
  }
  return { buildId: null, debugId: null };
}

/** MinidumpSimpleStringDictionary: a count, then key / value RVA pairs. */
function readDictionary(
  r: Reader,
  where: Location,
  into: Record<string, string>,
): void {
  if (where.size === 0) return;
  const n = r.count(where.rva);
  for (let i = 0; i < n; i++) {
    const at = where.rva + 4 + 8 * i;
    const key = r.utf8(r.u32(at));
    if (!(key in into)) into[key] = r.utf8(r.u32(at + 4));
  }
}

/** Crashpad's annotation objects: name, type, value; strings only. */
function readAnnotationObjects(
  r: Reader,
  where: Location,
  into: Record<string, string>,
): void {
  if (where.size === 0) return;
  const n = r.count(where.rva);
  for (let i = 0; i < n; i++) {
    const at = where.rva + 4 + 12 * i;
    if (r.u16(at + 4) !== 1) continue; // kString
    const key = r.utf8(r.u32(at));
    if (!(key in into)) into[key] = r.utf8(r.u32(at + 8));
  }
}

function readCrashpadInfo(
  r: Reader,
  stream: Location | undefined,
): Pick<Minidump, "annotations" | "moduleAnnotations"> {
  const annotations: Record<string, string> = {};
  const moduleAnnotations: Record<string, string> = {};
  // Older versions end before the module list.
  if (!stream || stream.size < 52) return { annotations, moduleAnnotations };
  // MinidumpCrashpadInfo: version, report and client UUIDs, then the simple
  // annotations and the module list.
  readDictionary(r, r.location(stream.rva + 36), annotations);
  const list = r.location(stream.rva + 44);
  if (list.size > 0) {
    const n = r.count(list.rva);
    for (let i = 0; i < n; i++) {
      // MinidumpModuleCrashpadInfoLink: the module's index, then where its
      // MinidumpModuleCrashpadInfo is (version, list annotations, simple
      // annotations, annotation objects).
      const info = r.location(list.rva + 4 + 12 * i + 4);
      if (info.size < 20) continue;
      readDictionary(r, r.location(info.rva + 12), moduleAnnotations);
      if (info.size >= 28) {
        readAnnotationObjects(r, r.location(info.rva + 20), moduleAnnotations);
      }
    }
  }
  return { annotations, moduleAnnotations };
}

/** Read a minidump file, reading only the parts readMinidump() asks for. */
export function readMinidumpFile(file: string): Minidump {
  const fd = fs.openSync(file, "r");
  try {
    const fileSize = fs.fstatSync(fd).size;
    return readMinidump((offset, length) => {
      if (offset + length > fileSize) throw new MinidumpError("truncated");
      const buf = Buffer.alloc(length);
      if (fs.readSync(fd, buf, 0, length, offset) !== length) {
        throw new MinidumpError("truncated");
      }
      return buf;
    });
  } finally {
    fs.closeSync(fd);
  }
}

const WINDOWS_EXCEPTIONS: Record<number, string> = {
  0x80000003: "EXCEPTION_BREAKPOINT",
  0x80000004: "EXCEPTION_SINGLE_STEP",
  0xc0000005: "EXCEPTION_ACCESS_VIOLATION",
  0xc0000006: "EXCEPTION_IN_PAGE_ERROR",
  0xc000001d: "EXCEPTION_ILLEGAL_INSTRUCTION",
  0xc0000094: "EXCEPTION_INT_DIVIDE_BY_ZERO",
  0xc0000096: "EXCEPTION_PRIV_INSTRUCTION",
  0xc00000fd: "EXCEPTION_STACK_OVERFLOW",
  0xc0000374: "STATUS_HEAP_CORRUPTION",
  0xc0000409: "STATUS_STACK_BUFFER_OVERRUN",
  0xe0000008: "Out of memory", // Chromium's kOomExceptionCode
};

const SIGNALS: Record<number, string> = {
  4: "SIGILL",
  5: "SIGTRAP",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  9: "SIGKILL",
  11: "SIGSEGV",
  31: "SIGSYS",
};

const MACH_EXCEPTIONS: Record<number, string> = {
  1: "EXC_BAD_ACCESS",
  2: "EXC_BAD_INSTRUCTION",
  3: "EXC_ARITHMETIC",
  5: "EXC_SOFTWARE",
  6: "EXC_BREAKPOINT",
  10: "EXC_CRASH",
  11: "EXC_RESOURCE",
  12: "EXC_GUARD",
};

const addr = (n: bigint): string => `0x${n.toString(16)}`;

/** "SIGSEGV (code 1)", "EXCEPTION_ACCESS_VIOLATION (0xC0000005)"… */
export function exceptionName(
  os: MinidumpOs,
  code: number,
  flags: number,
): string {
  if (os === "windows") {
    const name = WINDOWS_EXCEPTIONS[code];
    const raw = `0x${hex(code, 8)}`;
    return name ? `${name} (${raw})` : raw;
  }
  const names =
    os === "linux" ? SIGNALS : os === "macos" ? MACH_EXCEPTIONS : {};
  return `${names[code] ?? `0x${hex(code, 1)}`} (code ${flags})`;
}

const isMacSystemLibrary = (file: string): boolean =>
  file.startsWith("/System/") || file.startsWith("/usr/lib/");

/** The module the address falls in. */
function moduleAt(
  modules: MinidumpModule[],
  address: bigint,
): MinidumpModule | undefined {
  return modules.find(
    (m) => address >= m.base && address < m.base + BigInt(m.size),
  );
}

function moduleLine(m: MinidumpModule): string {
  const parts = [m.name];
  if (m.version) parts.push(m.version);
  if (m.buildId) parts.push(`build ID ${m.buildId}`);
  if (m.debugId) parts.push(`debug ID ${m.debugId}`);
  if (m.codeId) parts.push(`code ID ${m.codeId}`);
  return parts.join("  ");
}

export interface MinidumpSummary {
  /** Its ptype ("browser" for the main process); null if not known. */
  processType: string | null;
  /** Where it crashed: a few lines. */
  lines: string[];
  /**
   * One line per module, but macOS's system libraries; empty if the dump
   * could not be read.
   */
  modules: string[];
}

/**
 * Describe a dump as text: process type, exception, the module and offset it
 * crashed at, the chosen annotations, and the modules. Never throws: a dump
 * that cannot be read gets a one-line note.
 */
export function summarizeMinidump(
  file: string,
  annotationKeys: readonly string[],
): MinidumpSummary {
  let dump: Minidump;
  try {
    dump = readMinidumpFile(file);
  } catch (e) {
    const reason = e instanceof MinidumpError ? e.message : "unreadable";
    return {
      processType: null,
      lines: [`Could not be read (${reason}).`],
      modules: [],
    };
  }
  const lines: string[] = [];
  const ptype = dump.moduleAnnotations["ptype"] ?? dump.annotations["ptype"];
  lines.push(`Process: ${ptype ?? "unknown"}`);
  const ex = dump.exception;
  if (ex) {
    const thread = ex.threadName
      ? `${ex.threadId} (${ex.threadName})`
      : String(ex.threadId);
    lines.push(
      `Exception: ${exceptionName(dump.os, ex.code, ex.flags)} at ${addr(ex.address)}, thread ${thread}`,
    );
  } else {
    lines.push("Exception: none recorded");
  }
  const crashed =
    dump.pc === null ? undefined : moduleAt(dump.modules, dump.pc);
  if (dump.pc !== null) {
    lines.push(
      `Crashed at: ${crashed ? `${crashed.name} + ${addr(dump.pc - crashed.base)}` : `${addr(dump.pc)} (in no module)`}`,
    );
  }
  const chosen = annotationKeys.flatMap((k) =>
    k in dump.annotations ? [`${k}=${dump.annotations[k]}`] : [],
  );
  if (chosen.length > 0) lines.push(`Annotations: ${chosen.join(", ")}`);
  // Not macOS's own libraries: a process maps nearly a thousand of them from
  // the shared cache, more than an issue can hold. The one it crashed in is.
  const listed = dump.modules.filter(
    (m) =>
      m === crashed || !(dump.os === "macos" && isMacSystemLibrary(m.path)),
  );
  const modules = listed.map(moduleLine);
  const others = dump.modules.length - listed.length;
  if (others > 0) {
    modules.push(`(${others} macOS system libraries not listed)`);
  }
  return { processType: ptype ?? null, lines, modules };
}
