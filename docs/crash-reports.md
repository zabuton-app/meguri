# Crash Reports

This guide is for maintainers investigating native crashes. Meguri writes
dumps locally, with automatic upload disabled. A copied report contains a
summary, not the dump's memory; a summary alone cannot provide a full stack.

## Finding a dump

In Meguri, **Settings → About → Crash reports → Open folder** opens Electron's
`app.getPath("crashDumps")` directory. Search its subdirectories for the `.dmp`
named under **Dumps** in the report; use the name and timestamp to select the
right crash. The layout below that directory is an Electron implementation
detail. The text reports are separate, under `<userData>/crash-reports`.

For Meguri's normal profile, the dump directory is usually:

| Installation    | Directory                                                                     |
| --------------- | ----------------------------------------------------------------------------- |
| Windows         | `%APPDATA%\meguri\Crashpad`                                                   |
| macOS           | `~/Library/Application Support/meguri/Crashpad`                               |
| Linux           | `${XDG_CONFIG_HOME:-~/.config}/meguri/Crashpad`                               |
| Microsoft Store | `%LOCALAPPDATA%\Packages\<package-family>\LocalCache\Roaming\meguri\Crashpad` |

On Windows, package virtualization and existing data can affect the Store
path. Look under the `amgsk.meguri_*` package family or use **Open folder**
instead of assuming the example path. Custom profiles and builds can also use
different paths. Development builds do not enable crash reporting unless
`MEGURI_CRASH_REPORTS=1` is set. An unclean exit or a crash before the
reporter starts may have no dump.

## Privacy

Ask for a raw dump only if the summary is insufficient. A `.dmp` can contain
memory, including file names, paths, and other sensitive data. Ask the user for
consent and agree on a private transfer channel; never ask them to attach it to
a public GitHub issue. Ask for the specific dump, not the entire folder.
Store it with restricted access, do not upload it to third-party services, and
delete the received dump and any copies or derived files after use. Review and
redact stack traces before sharing them publicly.

## Match the symbols

From the report, record **Electron**, **OS** (platform and architecture),
**Installed from**, and the module and offset in **Crashed at**. The report's
module list belongs only to the newest readable dump, identified in its
heading; do not use it to identify another dump. Find the crashed module's
`debug ID` or Linux `build ID` there. The exception address can be a faulting
memory address, not the instruction pointer: use **Crashed at**, not the
exception address. If there is no module, offset, or matching identifier, do
not guess: use the raw dump and exact binary/build information instead.

For an official Electron build, download the matching release archive. For
example, in a POSIX shell, substitute the report's exact values (`win32`,
`darwin`, or `linux`; e.g. `x64` or `arm64`):

```sh
version=45.3.2
platform=linux
arch=x64
archive="electron-v${version}-${platform}-${arch}-symbols.zip"
curl -fL -O "https://github.com/electron/electron/releases/download/v${version}/${archive}"
unzip "$archive" -d electron-symbols
```

The archive's `breakpad_symbols` directory contains files in
`<debug-file>/<debug-id>/<symbol-name>.sym` layout. The symbol name is the
debug filename without `.pdb` on Windows, otherwise the debug filename. Its
`MODULE` header gives the OS, architecture, debug ID, and debug-file name. On
Windows the debug file may be a PDB named differently from the loaded
executable. Match the ID, not just the filename or version. For Windows and
macOS compare the summary's debug ID with the `MODULE` ID (ignoring hex case).

On Linux, the summary prints the ELF build ID, not Breakpad's debug ID.
Breakpad takes its first 16 bytes, zero-pads shorter IDs, formats the first
three GUID fields in little-endian order, and appends age `0`. Convert it
before comparing, for example:

```sh
python3 -c 'import sys, uuid; b = bytes.fromhex(sys.argv[1]); print(uuid.UUID(bytes_le=(b[:16].ljust(16, b"\0"))).hex.upper() + "0")' BUILD_ID
```

To locate candidates, set `id` to the summary's debug ID or the converted
Linux ID, then inspect each result's first line:

```sh
id=REPLACE_WITH_DEBUG_ID
find electron-symbols/breakpad_symbols -type f -ipath "*/${id}/*.sym" -print
head -n 1 "/path/to/candidate.sym"
```

Do not treat an ID mismatch as a match. Electron builds are not necessarily
reproducible: a source or distribution build may use a different binary even
at the same version. Obtain symbols from the exact build's distributor or
build artifacts. If the ID is missing or does not match, the release symbols
cannot establish a reliable result.

## Symbolize a summary's top frame

Choose the `.sym` whose `MODULE` ID matches as above. The offset after
`Crashed at: module +` is already relative to the module's load address. In
the [Breakpad symbol format](https://github.com/google/breakpad/blob/main/docs/symbol_files.md),
`FUNC [m] address size parameter_size name` uses hexadecimal addresses and
sizes. Find the record with `address <= offset < address + size`. For example:

```sh
sym="/path/to/matching/file.sym"
offset=0x1234 # replace with the report's offset
python3 - "$sym" "$offset" <<'PY'
import sys

offset = int(sys.argv[2], 16)
with open(sys.argv[1], encoding="utf-8") as symbols:
    for line in symbols:
        fields = line.rstrip("\n").split(" ", 4)
        if fields[0] != "FUNC":
            continue
        if fields[1] == "m":
            fields = line.rstrip("\n").split(" ", 5)
            fields.pop(1)
        start, size = int(fields[1], 16), int(fields[2], 16)
        if start <= offset < start + size:
            print(f"{fields[4]} + 0x{offset - start:x}")
PY
```

No output means no `FUNC` range matched; stripped or incomplete symbols may
only have `PUBLIC` records, whose size is not known. Avoid claiming a
definitive function from a nearest public symbol. Inline frames and source
lines may require further interpretation of the symbol file. A summary
contains only the top instruction pointer, not the rest of the stack.

## Walk a raw minidump

Obtain [Breakpad's `minidump_stackwalk`](https://github.com/google/breakpad#getting-started-from-main)
(build it following Breakpad's instructions), then run it locally with the
same matching Electron symbols:

```sh
minidump_stackwalk /private/path/crash.dmp electron-symbols/breakpad_symbols
```

If the tool is not on `PATH`, use the built `src/processor/minidump_stackwalk`
path. The output includes the crashing thread and the other threads. Check
the module list and missing-symbol diagnostics: stackwalk matches symbols by
debug file and ID, and frames without matching symbols remain unresolved.
Missing unwind information can also leave a stack incomplete. Add other
modules' matching Breakpad symbols to a symbol root in the same layout; do not
substitute a different build to fill gaps.

## Native modules

Electron's archive does not cover Meguri's native addon `better-sqlite3`.
Meguri packages its platform-specific prebuilt `.node` binary; its release
pipeline does not publish separate debug symbols for it. To resolve its frames,
obtain debug information for the exact shipped binary from its supplier or
the build artifacts, verify its ID, and use the platform's Breakpad
`dump_syms` on the matching binary and debug information to produce a `.sym`
file in the layout above. A locally rebuilt addon is not necessarily the
same build. If matching symbols cannot be obtained, leave those frames
unresolved. OS libraries and other external binaries likewise need their own
matching symbols.
