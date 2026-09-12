// Settings: About section. Shows the app version / runtime versions and the
// bundled third-party license attributions. The FFmpeg/FFprobe entry matters
// legally: the bundled binaries are GPL-licensed, so we must surface the
// license text and a way to obtain the corresponding source.
import { useEffect, useState } from "react";
import { ExternalLink, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type AboutInfo } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";

const GITHUB_URL = "https://github.com/zabuton-app/meguri";

interface ThirdPartyEntry {
  name: string;
  license: string;
  licenseUrl: string;
  /** Where to obtain the software / its source code. */
  sourceUrl: string;
}

// Notices for software bundled in the distributed app (not mere build tooling).
// The full dependency list lives in package.json on GitHub (linked below).
const THIRD_PARTY: ThirdPartyEntry[] = [
  // The ffmpeg/ffprobe executables themselves are GPL builds of FFmpeg; the
  // GPL corresponding-source obligation is satisfied by pointing at the
  // FFmpeg source download page (not just the npm wrappers below).
  {
    name: "FFmpeg / FFprobe (bundled binaries)",
    license: "GPL-3.0",
    licenseUrl: "https://www.gnu.org/licenses/gpl-3.0.html",
    sourceUrl: "https://ffmpeg.org/download.html",
  },
  {
    name: "ffmpeg-static (npm)",
    license: "GPL-3.0",
    licenseUrl:
      "https://github.com/eugeneware/ffmpeg-static/blob/master/LICENSE",
    sourceUrl: "https://github.com/eugeneware/ffmpeg-static",
  },
  {
    name: "ffprobe-static (npm)",
    license: "MIT",
    licenseUrl: "https://github.com/joshwnj/ffprobe-static/blob/master/LICENSE",
    sourceUrl: "https://github.com/joshwnj/ffprobe-static",
  },
  {
    name: "Electron (Chromium / Node.js)",
    license: "MIT",
    licenseUrl: "https://github.com/electron/electron/blob/main/LICENSE",
    sourceUrl: "https://github.com/electron/electron",
  },
  {
    name: "better-sqlite3",
    license: "MIT",
    licenseUrl:
      "https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE",
    sourceUrl: "https://github.com/WiseLibs/better-sqlite3",
  },
  {
    name: "React",
    license: "MIT",
    licenseUrl: "https://github.com/facebook/react/blob/main/LICENSE",
    sourceUrl: "https://github.com/facebook/react",
  },
  // Bundled emoji fonts for the selectable emoji styles
  // (details in src/assets/fonts/emoji/LICENSES.md).
  {
    name: "Twemoji Mozilla (emoji font)",
    license: "CC-BY 4.0 / Apache-2.0",
    licenseUrl:
      "https://github.com/mozilla/twemoji-colr/blob/master/LICENSE.md",
    sourceUrl: "https://github.com/mozilla/twemoji-colr",
  },
  {
    name: "Noto Emoji (emoji font)",
    license: "OFL-1.1",
    licenseUrl: "https://openfontlicense.org/",
    sourceUrl: "https://github.com/google/fonts/tree/main/ofl/notoemoji",
  },
  {
    name: "OpenMoji (emoji font)",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://github.com/hfg-gmuend/openmoji",
  },
];

export function AboutSection() {
  const { t } = useI18n();
  const [info, setInfo] = useState<AboutInfo | null>(null);

  useEffect(() => {
    let active = true;
    void api.aboutInfo().then((i) => {
      if (active) setInfo(i);
    });
    return () => {
      active = false;
    };
  }, []);

  // The section opts into selection as a whole: version strings get pasted into
  // bug reports, and the attributions below are notices we are obliged to
  // surface. The app has no Edit menu or context menu to copy them any other way.
  return (
    <section className="flex select-text flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      {/* App identity + version */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-bright-fg">
            {t("settings.about")}
          </span>
          <span className="text-xs text-muted">
            {info
              ? t("about.version", {
                  name: t("app.name"),
                  version: info.version,
                })
              : t("app.name")}
          </span>
          {info && (
            <span className="text-xs text-muted">
              Electron {info.electron} / Chromium {info.chrome} / Node{" "}
              {info.node}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void api.openUrl(GITHUB_URL)}
        >
          <ExternalLink className="size-4" />
          GitHub
        </Button>
      </div>

      {/* App license */}
      <p className="text-xs text-muted">
        {t("about.appLicense", { name: t("app.name") })}{" "}
        <button
          type="button"
          className="cursor-pointer underline hover:text-fg"
          onClick={() => void api.openUrl(`${GITHUB_URL}/blob/main/LICENSE`)}
        >
          MIT License
        </button>
      </p>

      {/* Third-party licenses */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-sm font-semibold text-bright-fg">
          {t("about.ossTitle")}
        </span>
        <p className="text-xs text-muted">{t("about.ossDesc")}</p>
        <p className="text-xs text-muted">{t("about.ffmpegNotice")}</p>
        <ul className="flex flex-col gap-1.5">
          {THIRD_PARTY.map((entry) => (
            <li
              key={entry.name}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-bg px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs text-fg">{entry.name}</span>
                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  {entry.license}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => void api.openUrl(entry.licenseUrl)}
                >
                  <Scale className="size-3.5" />
                  {t("about.license")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => void api.openUrl(entry.sourceUrl)}
                >
                  <ExternalLink className="size-3.5" />
                  {t("about.source")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="cursor-pointer self-start text-xs text-muted underline hover:text-fg"
          onClick={() =>
            void api.openUrl(`${GITHUB_URL}/blob/main/package.json`)
          }
        >
          {t("about.fullDependencies")}
        </button>
      </div>
    </section>
  );
}
