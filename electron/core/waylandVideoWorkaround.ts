/**
 * Chromium switch that keeps software-decoded video frames out of GPU memory
 * buffers.
 *
 * Since Electron 44, 10-bit AV1 video is black on Linux under Wayland (seen
 * with an NVIDIA GPU): the frames decode but are never presented (#407). This
 * switch avoids it and leaves GPU compositing on.
 *
 * It changes the upload path of every software-decoded video, not only 10-bit
 * AV1. The measured cost is dropped frames on 10-bit 4K video at 60 fps, which
 * would be black without it.
 *
 * Remove this once Chromium presents those frames again.
 */
export const WAYLAND_VIDEO_WORKAROUND_SWITCH =
  "disable-gpu-memory-buffer-video-frames";

/**
 * True when the app runs on Wayland. XWayland is not affected, so X11 is left
 * alone. `ozonePlatform` is the `--ozone-platform` switch: Electron resolves it
 * from the session before the main script runs, so it is the platform Chromium
 * will really use, whether or not the user passed it.
 */
export function needsWaylandVideoWorkaround(
  platform: NodeJS.Platform,
  ozonePlatform: string,
): boolean {
  return platform === "linux" && ozonePlatform === "wayland";
}
