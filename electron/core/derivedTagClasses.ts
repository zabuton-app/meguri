// What video and audio derived tags share (autoMetaTags.ts, audioMetaTags.ts):
// the `codec` and `dur` namespaces mean the same for both, so the rules that
// fill them live in one place.

/** Unknown but plausible codec names are kept as they are. */
const CODEC_SHAPE = /^[a-z0-9]{2,16}$/;

/**
 * A codec as its tag name: ffprobe's name folded by `aliases`, kept as it is
 * when it looks like a codec name, or null.
 */
export function codecTagName(
  raw: string,
  aliases: Readonly<Record<string, string>>,
): string | null {
  const lower = raw.trim().toLowerCase();
  return aliases[lower] ?? (CODEC_SHAPE.test(lower) ? lower : null);
}

/** Length class, the same for every kind of file. */
export function durationClass(seconds: number): string {
  if (seconds < 60) return "short";
  if (seconds <= 1800) return "medium";
  return "long";
}
