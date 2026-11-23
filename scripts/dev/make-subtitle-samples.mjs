// Sample videos with embedded subtitles, for trying the subtitle features
// (the `feature: subtitles` issues) without hunting for suitable files.
//
//   node scripts/dev/make-subtitle-samples.mjs [output-dir]
//
// Writes to samples/subtitles/ by default, where .gitignore keeps the videos
// out of Git. Open it with `MEGURI_ROOT=samples/subtitles npm run dev`, or in
// the Docker dev container add /media/library/subtitles as a workspace (the
// seeded ones are /media/library/1 and /2 only):
//
//   01-mkv-4tracks-10min-audio-eng.mkv  10 min, audio eng; SRT eng and jpn,
//     ASS fra, WebVTT kor. Cues cross the 2-minute loading windows (01:55-02:05,
//     03:55-04:05), and 00:30 has markup and special characters on two lines.
//   02-mp4-movtext-audio-jpn.mp4        3 min, audio jpn; mov_text eng and jpn.
//     Match audio language picks Japanese.
//   03-mkv-2audio-eng-jpn.mkv           3 min, audio eng and jpn; SRT eng and
//     jpn. With two audio tracks, Match audio language shows nothing.
//   04-mp4-no-subtitles.mp4             1 min, no subtitles: the control hides.
//   05-mkv-untagged-subtitles.mkv       3 min; two SRT tracks with no title and
//     language und, so their labels fall back to "Track N".
//
// Every 5 seconds a cue runs from t + 0.5 s to t + 4.5 s and carries its own
// time (`EN 01:25 — cue 17`), so timing drift is easy to spot. The video shows
// the playback time too, when the bundled ffmpeg finds a font for drawtext.
// The subtitle sources are written to a temporary directory and removed.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(repoRoot, "package.json"));
const { ffmpegPath } = require("@zabuton-app/ffmpeg-binaries");

const target = path.resolve(
  process.argv[2] ?? path.join(repoRoot, "samples", "subtitles"),
);

const LANGS = {
  eng: (time, n) => `EN ${time} — cue ${n}`,
  jpn: (time, n) => `日本語 ${time} キュー${n}`,
  fra: (time, n) =>
    `{\\i1}FR{\\i0} ${time} — réplique ${n}\\N(ASS → plain text)`,
  kor: (time, n) => `한국어 ${time} — 큐 ${n}`,
};

/** mm:ss */
function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** One cue every 5 seconds, from t + 0.5 s to t + 4.5 s. */
function regularCues(lang, duration) {
  const cues = [];
  for (let t = 0; t < duration; t += 5) {
    cues.push({
      start: t + 0.5,
      end: t + 4.5,
      text: LANGS[lang](clock(t), t / 5),
    });
  }
  return cues;
}

// File 01's extras: cues spanning the 2-minute loading window boundaries, and
// (English only) markup and special characters on two lines.
function file01Cues(lang) {
  const cues = regularCues(lang, 600);
  if (lang === "eng" || lang === "jpn") {
    const label = lang === "eng" ? "EN" : "日本語";
    for (const boundary of [120, 240]) {
      cues.push({
        start: boundary - 5,
        end: boundary + 5,
        text: `${label} ${clock(boundary - 5)}–${clock(boundary + 5)} (${clock(boundary)} boundary)`,
      });
    }
  }
  if (lang === "eng") {
    cues.push({
      start: 30,
      end: 34,
      text: "<i>italic</i> & <b>bold</b>:\n5 < 6 > 4",
    });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function timestamp(seconds, sep) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

function srt(cues) {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${timestamp(c.start, ",")} --> ${timestamp(c.end, ",")}\n${c.text}\n`,
    )
    .join("\n");
}

function webvtt(cues) {
  const body = cues.map(
    (c) =>
      `${timestamp(c.start, ".")} --> ${timestamp(c.end, ".")}\n${c.text}\n`,
  );
  return `WEBVTT\n\n${body.join("\n")}`;
}

/** H:MM:SS.cc */
function assTime(seconds) {
  const cs = Math.round(seconds * 100);
  const pad = (n) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360_000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

// The full standard Format: lines. With a shortened one, ffmpeg extracts
// empty text.
function ass(cues) {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 640",
    "PlayResY: 360",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map(
      (c) =>
        `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text}`,
    ),
    "",
  ].join("\n");
}

const WRITERS = {
  srt: { write: srt, codec: "srt" },
  ass: { write: ass, codec: "ass" },
  vtt: { write: webvtt, codec: "webvtt" },
};

// `subtitles[].lang` picks the cue text; `language` and `title` are the stream
// tags (omitted to leave a track untagged).
const FILES = [
  {
    file: "01-mkv-4tracks-10min-audio-eng.mkv",
    duration: 600,
    audio: ["eng"],
    subtitles: [
      { format: "srt", lang: "eng", language: "eng", title: "English" },
      { format: "srt", lang: "jpn", language: "jpn", title: "日本語" },
      { format: "ass", lang: "fra", language: "fra", title: "Français (ASS)" },
      { format: "vtt", lang: "kor", language: "kor", title: "한국어 (WebVTT)" },
    ],
    cues: file01Cues,
  },
  {
    file: "02-mp4-movtext-audio-jpn.mp4",
    duration: 180,
    audio: ["jpn"],
    subtitleCodec: "mov_text",
    subtitles: [
      { format: "srt", lang: "eng", language: "eng", title: "English" },
      { format: "srt", lang: "jpn", language: "jpn", title: "日本語" },
    ],
  },
  {
    file: "03-mkv-2audio-eng-jpn.mkv",
    duration: 180,
    audio: ["eng", "jpn"],
    subtitles: [
      { format: "srt", lang: "eng", language: "eng", title: "English" },
      { format: "srt", lang: "jpn", language: "jpn", title: "日本語" },
    ],
  },
  {
    file: "04-mp4-no-subtitles.mp4",
    duration: 60,
    audio: [undefined],
    subtitles: [],
  },
  {
    file: "05-mkv-untagged-subtitles.mkv",
    duration: 180,
    audio: ["eng"],
    subtitles: [
      { format: "srt", lang: "eng", language: "und" },
      { format: "srt", lang: "jpn", language: "und" },
    ],
  },
];

const TIME_OVERLAY =
  "drawtext=text='%{pts\\:hms}':x=16:y=16:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.6";

/** drawtext fails without a font; the cue text carries the time anyway. */
function canDrawText() {
  try {
    execFileSync(
      ffmpegPath,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=duration=0.1",
        "-vf",
        TIME_OVERLAY,
        "-f",
        "null",
        "-",
      ],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function generate(
  { file, duration, audio, subtitles, subtitleCodec, cues = regularCues },
  tmp,
  drawText,
) {
  const args = ["-y", "-v", "error"];
  args.push(
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=640x360:rate=24:duration=${duration}`,
  );
  audio.forEach((_, i) => {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${440 + 220 * i}:duration=${duration}`,
    );
  });
  subtitles.forEach((s, i) => {
    const source = path.join(tmp, `${path.parse(file).name}-${i}.${s.format}`);
    fs.writeFileSync(source, WRITERS[s.format].write(cues(s.lang, duration)));
    args.push("-i", source);
  });

  args.push("-map", "0:v");
  audio.forEach((_, i) => args.push("-map", `${1 + i}:a`));
  subtitles.forEach((_, i) => args.push("-map", `${1 + audio.length + i}:s`));

  if (drawText) args.push("-vf", TIME_OVERLAY);
  args.push(
    "-c:v",
    "libx264",
    // veryfast rather than ultrafast: a third of the size, a few seconds more.
    "-preset",
    "veryfast",
    "-crf",
    "32",
    "-pix_fmt",
    "yuv420p",
  );
  args.push("-c:a", "aac");
  audio.forEach((language, i) => {
    if (language) args.push(`-metadata:s:a:${i}`, `language=${language}`);
  });
  subtitles.forEach((s, i) => {
    args.push(`-c:s:${i}`, subtitleCodec ?? WRITERS[s.format].codec);
    args.push(`-metadata:s:s:${i}`, `language=${s.language}`);
    // MP4 has no title tag for a track: its name goes in the handler name,
    // which ffprobe reports in place of a title.
    if (s.title)
      args.push(
        `-metadata:s:s:${i}`,
        `${file.endsWith(".mp4") ? "handler_name" : "title"}=${s.title}`,
      );
  });
  args.push(path.join(target, file));

  execFileSync(ffmpegPath, args, { stdio: "inherit" });
  console.log(`wrote ${file}`);
}

fs.mkdirSync(target, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-subtitles-"));
try {
  const drawText = canDrawText();
  if (!drawText)
    console.log(
      "drawtext has no font: the videos will not show the playback time",
    );
  for (const spec of FILES) generate(spec, tmp, drawText);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`done: ${target}`);
