// Update check against GitHub Releases. Notification-only: this module never
// downloads or installs anything — it just compares the running version against
// the latest published *stable* release and reports whether a newer one exists.
//
// We hit /releases/latest, which GitHub defines as the most recent non-draft,
// non-prerelease release — so prereleases are excluded server-side and we don't
// have to filter a full list.
import { app, net } from "electron";
import { loadConfig, updateConfig, type UpdateConfig } from "./appConfig.js";
import { UpdateInfoSchema, type UpdateInfo } from "../../shared/ipc/schema.js";
import type { UpdateSettings } from "../../shared/ipc/channels.js";
import { scopedLog } from "./logger.js";

const log = scopedLog("updater");

// GitHub repo to check releases against. Mirrors package.json `repository`, but
// hard-coded here so a missing/odd repo field can't break the check silently.
const REPO_OWNER = "zabuton-app";
const REPO_NAME = "meguri";

/**
 * Resolve the target repo as `owner/name`. In development only, the
 * MEGURI_UPDATE_REPO env var (e.g. "amgsk/meguri-update-test") overrides it so
 * the update flow can be exercised against a throwaway public repo before this
 * one is published. Ignored in packaged builds so a stray env var can't point
 * release users at someone else's repo.
 */
function resolveRepo(): { owner: string; name: string } {
  // Only honor the override when we can positively confirm a dev build
  // (isPackaged === false). If it's undefined (e.g. a partial app stub) we fall
  // through to the real repo — fail safe so release users can't be redirected.
  if (app.isPackaged === false) {
    const override = process.env.MEGURI_UPDATE_REPO?.trim();
    const match = override?.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (match) {
      log.info(`using update repo override: ${match[1]}/${match[2]}`);
      return { owner: match[1], name: match[2] };
    }
  }
  return { owner: REPO_OWNER, name: REPO_NAME };
}

function latestReleaseApi(): string {
  const { owner, name } = resolveRepo();
  return `https://api.github.com/repos/${owner}/${name}/releases/latest`;
}

function releasesPage(): string {
  const { owner, name } = resolveRepo();
  return `https://github.com/${owner}/${name}/releases`;
}

// Don't hammer the API on every startup. Background/startup checks are skipped
// if the last successful check was within this window; the manual button passes
// `force` to bypass it.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h
const REQUEST_TIMEOUT_MS = 10_000;

/** Strip a leading "v"/"V" and trim. "v0.2.0" → "0.2.0". */
function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

/**
 * Compare two stable semver-ish versions (X.Y.Z, missing parts treated as 0).
 * Any pre-release suffix on either side is ignored — we only deal with stable
 * releases here. Returns >0 if `a` is newer, <0 if older, 0 if equal.
 *
 * Assumes release tags follow numeric dotted semver (the project's convention).
 * Non-numeric components are coerced to 0, so an off-convention tag (e.g.
 * "2024.06" or "latest") may compare in a surprising way — acceptable given we
 * control the release tags.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    normalizeVersion(v)
      .split("-")[0] // drop pre-release tag, if any
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/** Fetch the latest stable release via Electron's net (honors system proxy). */
function fetchLatestRelease(): Promise<GithubRelease> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: "GET", url: latestReleaseApi() });
    request.setHeader("Accept", "application/vnd.github+json");
    request.setHeader("User-Agent", `Meguri/${app.getVersion()}`);

    const timer = setTimeout(() => {
      request.abort();
      reject(new Error("update check timed out"));
    }, REQUEST_TIMEOUT_MS);

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timer);
        // Drain so the socket can close.
        response.on("data", () => {});
        response.on("end", () =>
          reject(new Error(`GitHub API returned ${response.statusCode}`)),
        );
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (c: Buffer) => chunks.push(c));
      response.on("end", () => {
        clearTimeout(timer);
        try {
          resolve(
            JSON.parse(Buffer.concat(chunks).toString("utf8")) as GithubRelease,
          );
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
    request.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    request.end();
  });
}

/**
 * Check GitHub for a newer stable release.
 *
 * Returns null if the network check could not complete (offline, rate-limited,
 * malformed response) — callers distinguish "no update" (available:false) from
 * "couldn't check" (null). `force` bypasses the throttle.
 */
export async function checkForUpdates(
  opts: { force?: boolean } = {},
): Promise<UpdateInfo | null> {
  const config = loadConfig();
  const current = app.getVersion();

  if (!opts.force && config.update.lastCheckAt != null) {
    const elapsed = Date.now() - config.update.lastCheckAt;
    if (elapsed >= 0 && elapsed < CHECK_THROTTLE_MS) {
      log.info("update check throttled; skipping");
      return null;
    }
  }

  let release: GithubRelease;
  try {
    release = await fetchLatestRelease();
  } catch (e) {
    log.warn("update check failed:", e);
    return null;
  }

  // Record the successful network round-trip so the throttle works next time.
  // Re-read inside updateConfig: the fetch above awaited, so `config` is stale
  // and must not be spread back wholesale (would clobber concurrent edits).
  updateConfig((c) => ({
    ...c,
    update: { ...c.update, lastCheckAt: Date.now() },
  }));

  const tag = typeof release.tag_name === "string" ? release.tag_name : null;
  if (!tag) {
    log.warn("latest release has no usable tag_name");
    return null;
  }
  const latest = normalizeVersion(tag);
  const isNewer = compareVersions(latest, current) > 0;
  // Re-read the ignored version too (it may have changed during the fetch).
  const ignored = loadConfig().update.ignoredVersion === latest;

  // Validate the shape we build from untrusted GitHub data before it crosses the
  // IPC boundary (ChannelOutputs is types-only, so this is the one runtime check).
  const parsed = UpdateInfoSchema.safeParse({
    current,
    latest,
    available: isNewer && !ignored,
    url:
      typeof release.html_url === "string" && release.html_url
        ? release.html_url
        : releasesPage(),
    name: typeof release.name === "string" ? release.name : null,
    publishedAt:
      typeof release.published_at === "string" ? release.published_at : null,
  });
  if (!parsed.success) {
    log.warn("update info failed validation:", parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export function getUpdateSettings(): UpdateSettings {
  const { update } = loadConfig();
  return { autoCheck: update.autoCheck, ignoredVersion: update.ignoredVersion };
}

export function setAutoCheck(enabled: boolean): void {
  updateConfig((c) => ({ ...c, update: { ...c.update, autoCheck: enabled } }));
}

/** Mark a version as skipped so the user isn't notified about it again. */
export function ignoreVersion(version: string): void {
  const normalized = normalizeVersion(version);
  updateConfig((c) => ({
    ...c,
    update: { ...c.update, ignoredVersion: normalized },
  }));
}

/** Whether startup auto-check is enabled. */
export function isAutoCheckEnabled(): boolean {
  return loadConfig().update.autoCheck;
}

export { releasesPage };
export type { UpdateConfig };
