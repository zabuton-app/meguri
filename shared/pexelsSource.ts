export interface PexelsSource {
  videoId: string;
  url: string;
}

export interface SourceReviewRow {
  id: number;
  workspaceId: string;
  relPath: string;
  width: number | null;
  height: number | null;
  metaKey: string;
  saved: PexelsSource | null;
  suggestion: PexelsSource | null;
}

export const MAX_SOURCE_URL = 2048;

export function parsePexelsVideoUrl(input: string): PexelsSource | null {
  const text = input.trim();
  if (!/^https:\/\//i.test(text) || text.length > MAX_SOURCE_URL) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (
    (url.hostname !== "pexels.com" && url.hostname !== "www.pexels.com") ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const match = url.pathname.match(
    /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?video\/((?:[a-z0-9]+-)*([1-9]\d{0,17}))\/?$/i,
  );
  if (!match) return null;
  const [, locale, slug, videoId] = match;
  return {
    videoId,
    url: `https://www.pexels.com/${locale ? locale.toLowerCase() + "/" : ""}video/${slug}/`,
  };
}

/** Recognize Pexels-branded names and its ID/quality/dimensions/fps download names. */
export function suggestPexelsSource(fileName: string): PexelsSource | null {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/ \(\d+\)$/, "");
  const match =
    stem.match(
      /^pexels-(?:[\p{L}\p{N}]+-)*([1-9]\d{0,17})(?:-\d+x\d+-\d+(?:\.\d+)?fps)?$/iu,
    ) ??
    stem.match(/^pexels videos? ([1-9]\d{0,17})(?:[- ].+)?$/i) ??
    stem.match(/^production id ([1-9]\d{0,17})$/i) ??
    stem.match(
      /^([1-9]\d{0,17})(?:[-_](?:sd|hd|uhd))?_\d+_\d+_\d+(?:\.\d+)?fps$/i,
    );
  return match
    ? parsePexelsVideoUrl(`https://www.pexels.com/video/${match[1]}/`)
    : null;
}
