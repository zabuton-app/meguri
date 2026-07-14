// Format helpers shared across the renderer. Two flavors:
// - Lists (grid/list/table cells): compact m:ss, empty/null fallback so falsy values
//   are dropped by Boolean filters or string concatenation.
// - Details (MediaDetail / Discover): h:mm:ss when applicable, with an em-dash
//   placeholder so empty values still render a visible "—".

export function formatDuration(
  d: number | null,
  opts: { hours?: boolean; fallback?: string } = {},
): string {
  const { hours = false, fallback = "" } = opts;
  if (!d || d <= 0) return fallback;
  if (hours) {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor(d % 60);
    const mm = m.toString().padStart(2, "0");
    const ss = s.toString().padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// `bytes` falsy (null/0) returns the fallback. Default fallback is "" so that
// list views' Boolean filters drop the value; details pass "—" explicitly.
export function formatSize(bytes: number | null, fallback = ""): string {
  if (!bytes) return fallback;
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
