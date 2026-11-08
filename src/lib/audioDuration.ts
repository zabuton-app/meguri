export type DurationFormat = "seconds" | "minutes" | "time";

/** Undefined is empty; null is invalid. Stored durations are always seconds. */
export function parseAudioDuration(
  text: string,
  format: DurationFormat,
): number | undefined | null {
  const value = text.trim();
  if (!value) return undefined;
  if (format === "time") {
    const match = /^(\d+):([0-5]\d)(\.\d{1,3})?$/.exec(value);
    if (!match) return null;
    const seconds = Number(match[1]) * 60 + Number(match[2] + (match[3] ?? ""));
    return Number.isFinite(seconds) ? seconds : null;
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const seconds = Number(value) * (format === "minutes" ? 60 : 1);
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatAudioDuration(
  seconds: number | undefined,
  format: DurationFormat,
): string {
  if (seconds == null) return "";
  if (format !== "time")
    return String(
      Number((seconds / (format === "minutes" ? 60 : 1)).toFixed(6)),
    );
  const millis = Math.round(seconds * 1000);
  const minutes = Math.floor(millis / 60000);
  const remainder = (millis % 60000) / 1000;
  return `${String(minutes).padStart(2, "0")}:${remainder < 10 ? "0" : ""}${remainder}`;
}
