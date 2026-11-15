/** A language tag from the file (ISO 639-2 such as "jpn", or BCP 47) as a name
 *  in the UI language. Unknown or malformed tags come back unchanged. */
export function languageName(code: string, uiLang: string): string {
  if (!code) return "";
  try {
    const [tag] = Intl.getCanonicalLocales(code);
    return (
      new Intl.DisplayNames([uiLang], { type: "language" }).of(tag) ?? code
    );
  } catch {
    return code;
  }
}

/**
 * How a track is named in the audio and subtitles panel: its title, else its
 * language, else `fallback` ("Track N"). `detail` is the language when the
 * label is something else, so it is not said twice.
 */
export function trackLabel(
  track: { title: string; language: string },
  fallback: string,
  uiLang: string,
): { label: string; detail: string } {
  const language = languageName(track.language, uiLang);
  const label = track.title || language || fallback;
  return { label, detail: language && language !== label ? language : "" };
}
