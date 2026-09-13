// MediaError codes as plain numbers: the MediaError global exists in Chromium
// but not in jsdom, so referencing it would break renderer tests.
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;

/** Whether an element's error means the media cannot be played.
 *
 *  MEDIA_ERR_ABORTED is what a normal interruption leaves behind — a `src`
 *  swap or a `load()` while a stream seek was in flight — not a broken file,
 *  so the player treats it as noise and so must anything deciding whether an
 *  element is still worth keeping. */
export function isFatalMediaError(error: MediaError | null): boolean {
  return error != null && error.code !== MEDIA_ERR_ABORTED;
}
