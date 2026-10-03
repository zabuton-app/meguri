// Standalone preview of the pet frames, for approving the art before it goes
// into the app. Run with `npm run pet:preview`.
import { frameToSvg } from "../../src/components/pet/petRender.ts";
import { PET_SIZE_SCALE } from "../../src/components/pet/petSize.ts";
import {
  PET_ANIMATIONS,
  PET_STATES,
} from "../../src/components/pet/petSprites.ts";

const SCALES = Object.values(PET_SIZE_SCALE);
const APPEARANCES = ["light", "dark"];

const root = document.getElementById("states");
const framesToggle = document.getElementById("frames");
const pauseToggle = document.getElementById("pause");

/** @type {{ el: HTMLElement; state: string; scale: number; appearance: string }[]} */
const players = [];

function stage(appearance, caption) {
  const el = document.createElement("div");
  el.className = `stage ${appearance}`;
  const svgHost = document.createElement("div");
  el.append(svgHost);
  if (caption) {
    const label = document.createElement("span");
    label.textContent = caption;
    el.append(label);
  }
  return { el, svgHost };
}

for (const state of PET_STATES) {
  const anim = PET_ANIMATIONS[state];
  const section = document.createElement("section");
  section.className = "state";
  const title = document.createElement("h2");
  title.textContent = state;
  const meta = document.createElement("small");
  meta.textContent = `${anim.frames.length} frames · ${anim.frameMs} ms · ${anim.loop ? "loop" : "once"}`;
  title.append(meta);
  section.append(title);

  const row = document.createElement("div");
  row.className = "row";
  for (const appearance of APPEARANCES) {
    for (const scale of SCALES) {
      const { el, svgHost } = stage(appearance, `×${scale} ${appearance}`);
      row.append(el);
      players.push({ el: svgHost, state, scale, appearance });
    }
  }
  section.append(row);

  const frames = document.createElement("div");
  frames.className = "frames";
  anim.frames.forEach((frame, i) => {
    for (const appearance of APPEARANCES) {
      const { el, svgHost } = stage(appearance, `#${i + 1}`);
      svgHost.innerHTML = frameToSvg(frame, { scale: 3, appearance });
      frames.append(el);
    }
  });
  section.append(frames);
  root.append(section);
}

framesToggle.addEventListener("change", () => {
  for (const el of document.querySelectorAll(".frames")) {
    el.hidden = !framesToggle.checked;
  }
});

// One clock drives every player. Looping states cycle; one-shot states play
// through, hold the last frame for a beat, then replay so they can be judged.
const HOLD_MS = 800;
const start = performance.now();
let paused = false;
let pausedAt = 0;
let offset = 0;

pauseToggle.addEventListener("change", () => {
  paused = pauseToggle.checked;
  if (paused) pausedAt = performance.now();
  else offset += performance.now() - pausedAt;
});

const shown = new Map();
function tick(now) {
  if (!paused) {
    const t = Math.max(0, now - start - offset);
    for (const p of players) {
      const anim = PET_ANIMATIONS[p.state];
      const n = anim.frames.length;
      const cycle = anim.loop ? n * anim.frameMs : n * anim.frameMs + HOLD_MS;
      const index = Math.min(n - 1, Math.floor((t % cycle) / anim.frameMs));
      if (shown.get(p) !== index) {
        shown.set(p, index);
        p.el.innerHTML = frameToSvg(anim.frames[index], {
          scale: p.scale,
          appearance: p.appearance,
        });
      }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
