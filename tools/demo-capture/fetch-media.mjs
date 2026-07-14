// Download a small copyright-free sample library for the README captures.
// Images: Lorem Picsum (https://picsum.photos). Videos: Blender open movies
// via test-videos.co.uk (CC-BY). Everything lands in tools/demo-capture/.media
// (or the directory given as the first CLI argument).
import fs from "node:fs";
import path from "node:path";
import { defaultMediaDir } from "./lib.mjs";

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultMediaDir;

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

await Promise.all([...IMAGES, ...VIDEOS].map(download));
console.log(`done: ${target}`);
