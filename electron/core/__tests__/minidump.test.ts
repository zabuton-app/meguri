import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exceptionName,
  readMinidump,
  readMinidumpFile,
  summarizeMinidump,
} from "../minidump.js";

// Dumps of a test build crashed on purpose (process.crash() in the main
// process), made by scripts/dev/crash-fixture.mjs. Never a user's dump.
const fixtures = path.join(import.meta.dirname, "fixtures", "minidump");
const KEYS = ["_productName", "_companyName", "_version", "channel"];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-minidump-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("fixture dumps", () => {
  it("summarizes a Linux x64 main process crash", () => {
    const summary = summarizeMinidump(
      path.join(fixtures, "linux-x64.dmp"),
      KEYS,
    );
    expect(summary.processType).toBe("browser");
    expect(summary.lines).toEqual([
      "Process: browser",
      "Exception: SIGSEGV (code 1) at 0x0, thread 1574028 (electron)",
      "Crashed at: electron + 0x64908b4",
      "Annotations: _productName=Meguri, _version=0.0, channel=Other",
    ]);
    expect(summary.modules).toContain(
      "electron  build ID d05648a05ca33a5438fc35b405ef0f4a3a73ee8f",
    );
    expect(summary.modules).toContain(
      "libc.so.6  build ID 6961407ef2e7877eabf5ed8c5a39aea9de7194c1",
    );
    // File names only: no directory, so no user or install path.
    for (const line of summary.modules) expect(line).not.toMatch(/[/\\]/);
  });

  it("summarizes a Windows x64 main process crash", () => {
    const summary = summarizeMinidump(
      path.join(fixtures, "win32-x64.dmp"),
      KEYS,
    );
    expect(summary.lines).toEqual([
      "Process: browser",
      "Exception: EXCEPTION_ACCESS_VIOLATION (0xC0000005) at 0x7ff69d215230, thread 2244 (CrBrowserMain)",
      "Crashed at: electron.exe + 0x3b55230",
      "Annotations: _productName=Meguri, _version=45.2.3, channel=Built from source",
    ]);
    expect(summary.modules[0]).toBe(
      "electron.exe  45.2.3.0  debug ID 88ED9F7D2F2960004C4C44205044422E1  code ID 6AEB5400efa3000",
    );
    expect(summary.modules.some((l) => l.startsWith("win32-x64.node  "))).toBe(
      true,
    );
    for (const line of summary.modules) expect(line).not.toMatch(/[/\\]/);
  });

  it("summarizes a macOS arm64 main process crash, without the system libraries", () => {
    const file = path.join(fixtures, "darwin-arm64.dmp");
    const summary = summarizeMinidump(file, KEYS);
    expect(summary.lines).toEqual([
      "Process: browser",
      "Exception: EXC_BAD_ACCESS (code 1) at 0x0, thread 8094 (CrBrowserMain)",
      "Crashed at: Electron Framework + 0x2ef4d14",
      "Annotations: _productName=Meguri, _version=45.2.3, channel=Built from source",
    ]);
    const total = readMinidumpFile(file).modules.length;
    expect(summary.modules).toEqual([
      "Electron  debug ID 4C4C44E455553144A1DC03DD9B4EDAAF0",
      "Electron Framework  debug ID 4C4C444955553144A1140A6A3F9F95630",
      "Squirrel  debug ID 4C4C443C55553144A11B8846F26DEDB90",
      "ReactiveObjC  debug ID 4C4C446555553144A1DA2A74B3FDF91E0",
      "Mantle  debug ID 4C4C444755553144A1894A309BEB1C420",
      "libffmpeg.dylib  debug ID 4C4C447955553144A1E189891DEBFC530",
      "darwin-arm64.node  debug ID C87A9325F7483E3191DC18CFB1217A680",
      `(${total - 7} macOS system libraries not listed)`,
    ]);
  });

  it("quotes only the annotations asked for", () => {
    const file = path.join(fixtures, "linux-x64.dmp");
    expect(readMinidumpFile(file).annotations).toHaveProperty("lsb-release");
    const text = summarizeMinidump(file, ["channel"]).lines.join("\n");
    expect(text).toContain("Annotations: channel=Other");
    expect(text).not.toContain("Arch Linux");
  });
});

describe("dumps that cannot be read", () => {
  const linux = () => fs.readFileSync(path.join(fixtures, "linux-x64.dmp"));
  const summarize = (bytes: Buffer) => {
    const file = path.join(dir, "x.dmp");
    fs.writeFileSync(file, bytes);
    return summarizeMinidump(file, KEYS);
  };

  it("notes a truncated dump", () => {
    expect(summarize(linux().subarray(0, 3000))).toEqual({
      processType: null,
      lines: ["Could not be read (truncated)."],
      modules: [],
    });
  });

  it("notes a file that is not a minidump", () => {
    expect(summarize(Buffer.from("MDMP")).lines).toEqual([
      "Could not be read (truncated).",
    ]);
    expect(summarize(Buffer.alloc(64)).lines).toEqual([
      "Could not be read (not a minidump).",
    ]);
  });

  it("notes a corrupt count instead of reading on", () => {
    const b = linux();
    b.writeUInt32LE(0xffffffff, 8); // the number of streams
    expect(summarize(b).lines).toEqual([
      "Could not be read (too many entries (4294967295)).",
    ]);
  });

  it("notes a missing file", () => {
    expect(summarizeMinidump(path.join(dir, "gone.dmp"), KEYS).lines).toEqual([
      "Could not be read (unreadable).",
    ]);
  });
});

/**
 * A minimal dump: system info, an exception with a thread context, and one
 * module with a PDB 7.0 record, as Windows and macOS dumps have.
 */
function syntheticDump(opts: {
  platformId: number;
  cpu: number;
  code: number;
  pcOffset: number;
  pc: bigint;
  name?: string;
}): Buffer {
  const b = Buffer.alloc(4096);
  b.writeUInt32LE(0x504d444d, 0);
  b.writeUInt32LE(0xa793, 4);
  b.writeUInt32LE(3, 8);
  b.writeUInt32LE(32, 12);
  const streams = [
    [7, 56, 100], // system info
    [6, 168, 200], // exception
    [4, 4 + 108, 1000], // module list
  ];
  streams.forEach(([type, size, rva], i) => {
    b.writeUInt32LE(type, 32 + 12 * i);
    b.writeUInt32LE(size, 36 + 12 * i);
    b.writeUInt32LE(rva, 40 + 12 * i);
  });
  b.writeUInt16LE(opts.cpu, 100);
  b.writeUInt32LE(opts.platformId, 120);
  // Exception: thread 7, the code, address 0x10, context at 400.
  b.writeUInt32LE(7, 200);
  b.writeUInt32LE(opts.code, 208);
  b.writeBigUInt64LE(0x10n, 224);
  b.writeUInt32LE(1232, 360);
  b.writeUInt32LE(400, 364);
  b.writeBigUInt64LE(opts.pc, 400 + opts.pcOffset);
  // One module at 0x140000000, 0x10000 bytes, version 45.2.3.0.
  const m = 1004;
  b.writeUInt32LE(1, 1000);
  b.writeBigUInt64LE(0x140000000n, m);
  b.writeUInt32LE(0x10000, m + 8);
  b.writeUInt32LE(0x5f5e100, m + 16);
  b.writeUInt32LE(2000, m + 20);
  b.writeUInt32LE(0xfeef04bd, m + 24);
  b.writeUInt32LE((45 << 16) | 2, m + 32);
  b.writeUInt32LE(3 << 16, m + 36);
  b.writeUInt32LE(24, m + 76);
  b.writeUInt32LE(2200, m + 80);
  const name =
    opts.name ?? "C:\\Users\\someone\\AppData\\Local\\Meguri\\Meguri.exe";
  b.writeUInt32LE(name.length * 2, 2000);
  b.write(name, 2004, "utf16le");
  // RSDS, GUID 00112233-4455-6677-8899-AABBCCDDEEFF, age 2.
  b.writeUInt32LE(0x53445352, 2200);
  b.writeUInt32LE(0x00112233, 2204);
  b.writeUInt16LE(0x4455, 2208);
  b.writeUInt16LE(0x6677, 2210);
  Buffer.from("8899aabbccddeeff", "hex").copy(b, 2212);
  b.writeUInt32LE(2, 2220);
  return b;
}

describe("synthetic dumps", () => {
  const read = (b: Buffer) =>
    readMinidump((offset, length) => b.subarray(offset, offset + length));

  it("reads a Windows x64 dump: debug ID, code ID, version", () => {
    const d = read(
      syntheticDump({
        platformId: 2,
        cpu: 9,
        code: 0xc0000005,
        pcOffset: 0xf8,
        pc: 0x140001234n,
      }),
    );
    expect(d.os).toBe("windows");
    expect(d.pc).toBe(0x140001234n);
    expect(d.modules).toEqual([
      {
        name: "Meguri.exe",
        path: "C:\\Users\\someone\\AppData\\Local\\Meguri\\Meguri.exe",
        base: 0x140000000n,
        size: 0x10000,
        version: "45.2.3.0",
        buildId: null,
        debugId: "00112233445566778899AABBCCDDEEFF2",
        codeId: "05F5E10010000",
      },
    ]);
  });

  it("finds the instruction pointer of an ARM64 context", () => {
    const d = read(
      syntheticDump({
        platformId: 0x8101,
        cpu: 12,
        code: 1,
        pcOffset: 0x108,
        pc: 0x140000010n,
      }),
    );
    expect(d.os).toBe("macos");
    expect(d.pc).toBe(0x140000010n);
    expect(d.modules[0]?.codeId).toBeNull();
  });

  it("skips a Crashpad info stream too short for its lists", () => {
    const b = syntheticDump({
      platformId: 0x8201,
      cpu: 9,
      code: 11,
      pcOffset: 0xf8,
      pc: 0x140000010n,
    });
    b.writeUInt32LE(4, 8);
    b.writeUInt32LE(0x43500001, 68);
    b.writeUInt32LE(36, 72);
    b.writeUInt32LE(3000, 76);
    // What lies past it would read as a list far beyond the file.
    b.writeUInt32LE(8, 3036);
    b.writeUInt32LE(0xfffffff0, 3040);
    expect(read(b).annotations).toEqual({});
  });

  it("notes thread names that run past their stream", () => {
    const b = syntheticDump({
      platformId: 0x8201,
      cpu: 9,
      code: 11,
      pcOffset: 0xf8,
      pc: 0x140000010n,
    });
    b.writeUInt32LE(4, 8);
    b.writeUInt32LE(24, 68);
    b.writeUInt32LE(16, 72);
    b.writeUInt32LE(3000, 76);
    b.writeUInt32LE(2, 3000);
    expect(() => read(b)).toThrow("thread names larger than their stream");
  });
});

describe("exceptionName", () => {
  it("names exceptions per OS, and gives unknown ones as numbers", () => {
    expect(exceptionName("windows", 0xc0000005, 0)).toBe(
      "EXCEPTION_ACCESS_VIOLATION (0xC0000005)",
    );
    expect(exceptionName("windows", 0x12345678, 0)).toBe("0x12345678");
    expect(exceptionName("macos", 1, 2)).toBe("EXC_BAD_ACCESS (code 2)");
    expect(exceptionName("linux", 6, 0)).toBe("SIGABRT (code 0)");
    expect(exceptionName("linux", 0xffffffff, 0)).toBe("0xFFFFFFFF (code 0)");
  });
});

describe("corrupt dumps", () => {
  const summarize = (bytes: Buffer) => {
    const file = path.join(dir, "x.dmp");
    fs.writeFileSync(file, bytes);
    return summarizeMinidump(file, KEYS).lines;
  };

  it("stops reading lists that point at the same entries over and over", () => {
    // Crashpad info: 4096 module links, all to one module info whose
    // dictionary has 4096 entries, all to one string.
    const n = 4096;
    const list = 100;
    const info = list + 4 + 12 * n;
    const dict = info + 28;
    const str = dict + 4 + 8 * n;
    const b = Buffer.alloc(str + 8);
    b.writeUInt32LE(0x504d444d, 0);
    b.writeUInt32LE(0xa793, 4);
    b.writeUInt32LE(1, 8);
    b.writeUInt32LE(32, 12);
    b.writeUInt32LE(0x43500001, 32);
    b.writeUInt32LE(52, 36);
    b.writeUInt32LE(48, 40);
    b.writeUInt32LE(4 + 12 * n, 48 + 44);
    b.writeUInt32LE(list, 48 + 48);
    b.writeUInt32LE(n, list);
    for (let i = 0; i < n; i++) {
      b.writeUInt32LE(28, list + 4 + 12 * i + 4);
      b.writeUInt32LE(info, list + 4 + 12 * i + 8);
    }
    b.writeUInt32LE(4 + 8 * n, info + 12);
    b.writeUInt32LE(dict, info + 16);
    b.writeUInt32LE(n, dict);
    for (let i = 0; i < n; i++) {
      b.writeUInt32LE(str, dict + 4 + 8 * i);
      b.writeUInt32LE(str, dict + 8 + 8 * i);
    }
    b.writeUInt32LE(3, str);
    b.write("key", str + 4);
    const started = Date.now();
    expect(summarize(b)).toEqual(["Could not be read (too large)."]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("does not let a string in the dump break a line of the report", () => {
    const d = readMinidump((offset, length) => {
      const b = syntheticDump({
        platformId: 2,
        cpu: 9,
        code: 0xc0000005,
        pcOffset: 0xf8,
        pc: 0n,
        name: "C:\\x\\evil\nDumps:.dll",
      });
      return b.subarray(offset, offset + length);
    });
    expect(d.modules[0]?.name).toBe("evil?Dumps:.dll");
  });
});

it("debug IDs end with the age in lowercase, as Breakpad writes them", () => {
  const b = syntheticDump({
    platformId: 2,
    cpu: 9,
    code: 0xc0000005,
    pcOffset: 0xf8,
    pc: 0n,
  });
  b.writeUInt32LE(0xab, 2220);
  const d = readMinidump((offset, length) =>
    b.subarray(offset, offset + length),
  );
  expect(d.modules[0]?.debugId).toBe("00112233445566778899AABBCCDDEEFFab");
});
