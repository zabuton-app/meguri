/** Display dimensions, matched independently of landscape or portrait orientation. */
export const RESOLUTIONS = {
  sd: { label: "SD", width: 640, height: 480 },
  hd: { label: "720p HD", width: 1280, height: 720 },
  fullHd: { label: "1080p Full HD", width: 1920, height: 1080 },
  qhd: { label: "1440p QHD", width: 2560, height: 1440 },
  uhd: { label: "4K UHD", width: 3840, height: 2160 },
  dci4k: { label: "4K DCI", width: 4096, height: 2160 },
  uhd8k: { label: "8K UHD", width: 7680, height: 4320 },
} as const;

export const RESOLUTION_IDS = [
  "sd",
  "hd",
  "fullHd",
  "qhd",
  "uhd",
  "dci4k",
  "uhd8k",
] as const;

export function resolutionLabel(id: keyof typeof RESOLUTIONS): string {
  const { label, width, height } = RESOLUTIONS[id];
  return `${label} (${width} × ${height})`;
}
