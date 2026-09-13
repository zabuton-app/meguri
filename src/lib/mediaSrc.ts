// The media server URL of a file and its one query parameter, `t`: the second
// a container the browser cannot seek by itself (mkv/avi/wmv/flv/ts, remuxed
// on the fly) is re-served from. The player writes it, the hand-off between
// routes must see through it, and a player adopting such an element has to
// read it back as its position offset — one place for all three.

/** `src` re-served from `sec` seconds in. */
export function withStreamSeek(src: string, sec: number): string {
  const url = new URL(src);
  url.searchParams.set("t", String(Math.floor(sec)));
  return url.toString();
}

/** `src` without the stream-seek parameter; any other query is kept. */
export function withoutStreamSeek(src: string | null): string {
  if (!src) return "";
  try {
    const url = new URL(src);
    url.searchParams.delete("t");
    return url.toString();
  } catch {
    return src;
  }
}

/** Whether two URLs name the same file, whatever second each is served from. */
export function isSameMediaSource(a: string | null, b: string | null): boolean {
  return withoutStreamSeek(a) === withoutStreamSeek(b);
}

/** The second `src` was re-served from; 0 when served from the top. */
export function streamOffsetOf(src: string | null): number {
  if (!src) return 0;
  try {
    const t = Number(new URL(src).searchParams.get("t"));
    return Number.isFinite(t) && t > 0 ? t : 0;
  } catch {
    return 0;
  }
}
