// Splits the paths of a duplicate group's copies into the parts they share and
// the parts that tell them apart, so the view can highlight what differs
// (usually a folder, or a " (1)" suffix on the file name).
//
// Folders are compared segment by segment from the root: the leading segments
// every copy has in common are "same", the rest of each folder is "diff". File
// names are compared by their common prefix and suffix, so only the middle
// that differs is highlighted. Names compare by code point, not UTF-16 unit,
// so a surrogate pair is never split.

export type PathPartKind = "same" | "diff" | "name";

export interface PathPart {
  text: string;
  kind: PathPartKind;
}

/** Folder segments, each keeping its trailing separator ("a/", "b\\"). */
function splitPath(relPath: string): { dirs: string[]; name: string } {
  const i = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  const dir = relPath.slice(0, i + 1);
  return {
    dirs: dir.match(/[^\\/]*[\\/]/g) ?? [],
    name: relPath.slice(i + 1),
  };
}

function commonPrefixLength(lists: readonly (readonly string[])[]): number {
  const min = Math.min(...lists.map((l) => l.length));
  let n = 0;
  while (n < min && lists.every((l) => l[n] === lists[0][n])) n++;
  return n;
}

function commonSuffixLength(
  lists: readonly (readonly string[])[],
  max: number,
): number {
  let n = 0;
  while (
    n < max &&
    lists.every(
      (l) => l[l.length - 1 - n] === lists[0][lists[0].length - 1 - n],
    )
  )
    n++;
  return n;
}

export function diffPaths(relPaths: readonly string[]): PathPart[][] {
  const split = relPaths.map(splitPath);
  const sharedDirs = commonPrefixLength(split.map((s) => s.dirs));

  const names = split.map((s) => Array.from(s.name));
  const sameName = names.every((n) => n.join("") === names[0].join(""));
  const prefix = sameName ? 0 : commonPrefixLength(names);
  const shortest = Math.min(...names.map((n) => n.length));
  const suffix = sameName ? 0 : commonSuffixLength(names, shortest - prefix);

  return split.map(({ dirs }, i) => {
    const name = names[i];
    const parts: PathPart[] = [
      { text: dirs.slice(0, sharedDirs).join(""), kind: "same" },
      { text: dirs.slice(sharedDirs).join(""), kind: "diff" },
    ];
    if (sameName) {
      parts.push({ text: name.join(""), kind: "name" });
    } else {
      parts.push(
        { text: name.slice(0, prefix).join(""), kind: "name" },
        {
          text: name.slice(prefix, name.length - suffix).join(""),
          kind: "diff",
        },
        { text: name.slice(name.length - suffix).join(""), kind: "name" },
      );
    }
    return merge(parts);
  });
}

/** Drops empty parts and joins neighbors of the same kind. */
function merge(parts: PathPart[]): PathPart[] {
  const out: PathPart[] = [];
  for (const part of parts) {
    if (part.text === "") continue;
    const last = out[out.length - 1];
    if (last?.kind === part.kind) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}
