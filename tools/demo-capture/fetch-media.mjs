// Download a small copyright-free sample library for the README captures.
// Images: Lorem Picsum (https://picsum.photos). Videos: Blender open movies
// via test-videos.co.uk (CC-BY). Audio: a few tracks synthesised locally with
// the bundled ffmpeg (tones and noise, so nothing to license), with a Picsum
// photo embedded as cover art on most of them. Everything lands in
// tools/demo-capture/.media (or the directory given as the first CLI
// argument). `--audio-only` skips the downloads and just (re)writes the
// audio tracks.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultMediaDir, repoRoot } from "./lib.mjs";

const require = createRequire(path.join(repoRoot, "package.json"));
const ffmpegPath = require("ffmpeg-static");

const args = process.argv.slice(2);
const audioOnly = args.includes("--audio-only");
const dirArg = args.find((a) => !a.startsWith("--"));
const target = dirArg ? path.resolve(dirArg) : defaultMediaDir;

const IMAGES = Array.from({ length: 12 }, (_, i) => ({
  url: `https://picsum.photos/seed/meguri${i + 1}/1280/720`,
  file: path.join("Nature", `photo-${i + 1}.jpg`),
}));

const VIDEOS = [
  ["Big_Buck_Bunny_720_10s_5MB.mp4", "bigbuckbunny", "bbb-10s.mp4"],
  ["Sintel_720_10s_5MB.mp4", "sintel", "sintel-10s.mp4"],
  ["Jellyfish_720_10s_5MB.mp4", "jellyfish", "jellyfish-10s.mp4"],
].map(([name, slug, file]) => ({
  url: `https://test-videos.co.uk/vids/${slug}/mp4/h264/720/${name}`,
  file: path.join("Animation", file),
}));

async function download({ url, file }) {
  const dest = path.join(target, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${file}`);
}

// Each track is a lavfi source (a chord of sines, or filtered noise) with
// tags, so the bar and the detail view have a title and an artist to show.
const AUDIO = [
  {
    file: "Morning Coast.mp3",
    title: "Morning Coast",
    artist: "Meguri Samples",
    album: "Sample Tracks",
    src: "sine=frequency=220:duration=95",
    filter: "aecho=0.8:0.7:60:0.4,volume=0.4",
    cover: "photo-3.jpg",
  },
  {
    file: "Night Drive.mp3",
    title: "Night Drive",
    artist: "Meguri Samples",
    album: "Sample Tracks",
    src: "anoisesrc=color=brown:duration=142:seed=7",
    filter: "lowpass=f=400,volume=0.5",
    cover: "photo-10.jpg",
  },
  {
    file: "Quiet Garden.mp3",
    title: "Quiet Garden",
    artist: "Meguri Samples",
    album: "Sample Tracks",
    src: "sine=frequency=330:duration=118",
    filter: "tremolo=f=0.5:d=0.6,volume=0.35",
    cover: "photo-6.jpg",
  },
  {
    // Deliberately without cover art: the placeholder tile is part of the UI.
    file: "Field Notes.mp3",
    title: "Field Notes",
    artist: "Meguri Samples",
    album: "Sample Tracks",
    src: "anoisesrc=color=pink:duration=64:seed=3",
    filter: "lowpass=f=1200,volume=0.3",
  },
];

function synthesize({ file, title, artist, album, src, filter, cover }) {
  const dest = path.join(target, "Music", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i", src];
  if (cover) args.push("-i", path.join(target, "Nature", cover));
  args.push("-map", "0:a", "-af", filter, "-c:a", "libmp3lame", "-q:a", "4");
  if (cover) {
    // ID3v2 attached picture, scaled down so the cover does not dwarf the track.
    args.push(
      "-map",
      "1:v",
      "-c:v",
      "mjpeg",
      "-vf",
      "scale=600:-1",
      "-disposition:v",
      "attached_pic",
      "-id3v2_version",
      "3",
    );
  }
  args.push(
    "-metadata",
    `title=${title}`,
    "-metadata",
    `artist=${artist}`,
    "-metadata",
    `album=${album}`,
    dest,
  );
  execFileSync(ffmpegPath, args, { stdio: "inherit" });
  console.log(`synthesised Music/${file}`);
}

if (!audioOnly) await Promise.all([...IMAGES, ...VIDEOS].map(download));
for (const track of AUDIO) synthesize(track);
console.log(`done: ${target}`);
