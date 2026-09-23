// On-disk store for the CLIP models the user supplies.
//
// Nothing ships with the app and nothing is fetched over the network: the user
// obtains a model exported in the transformers.js layout (`onnx/vision_model*.onnx`
// + `onnx/text_model*.onnx` + tokenizer + configs) and drops the directory into
// `<userData>/models/`. There is no import step — the folder *is* the
// installation, and this module only reads it.
//
// Keeping acquisition out of the app is what lets Meguri go on claiming it makes
// no external request beyond the optional update check — a claim that is checked
// by grepping this tree, so a disabled-by-default downloader would not do. Making
// the folder the installation is what keeps the rest simple: nothing is copied,
// so nothing can be half-copied, and removing a model is removing a directory.
import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AiModelInfo } from "../../../shared/ipc/schema.js";
import { scopedLog } from "../logger.js";

const log = scopedLog("ai:models");

/** Files a model needs besides the two ONNX graphs. */
const REQUIRED_AUX = ["config.json", "tokenizer.json"] as const;

export interface ModelFile {
  /** Path relative to the model directory, POSIX-style. */
  path: string;
  size: number;
}

export interface PreprocessParams {
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
}

/** Everything the runtime needs to load one variant of one model directory. */
export interface ModelDescriptor {
  id: string;
  /** The directory name, which is the model's display name. */
  name: string;
  variant: string;
  dim: number;
  /** Vision / text ONNX paths relative to the model directory. */
  vision: string;
  text: string;
  preprocess: PreprocessParams;
}

/** OpenAI CLIP normalization — the defaults when the model ships no preprocessor_config.json. */
const CLIP_DEFAULT_PREPROCESS: PreprocessParams = {
  size: 224,
  mean: [0.48145466, 0.4578275, 0.40821073],
  std: [0.26862954, 0.26130258, 0.27577711],
};

/**
 * Bounds on the two numbers a model file gets to choose that the app then turns
 * into an allocation: the embedding width and the square it decodes frames into.
 * Both are far above any real CLIP-family export (768 and 448 at the top end),
 * and both exist so a typo — or a hostile config — cannot ask for a
 * multi-gigabyte buffer in the main process.
 */
const MAX_DIM = 8192;
const MAX_PREPROCESS_SIZE = 1024;
const MIN_PREPROCESS_SIZE = 32;

/** Where the user puts model directories. */
export function modelsDir(): string {
  return path.join(app.getPath("userData"), "models");
}

/**
 * Create the models folder if it is not there yet, so settings can offer to open
 * it on a first run. The instruction is "put a model in this folder", and a
 * folder that does not exist until something has been put in it is a poor way to
 * give it. Failure is logged and shrugged off: it only costs the button.
 */
export function ensureModelsDir(): void {
  try {
    fs.mkdirSync(modelsDir(), { recursive: true });
  } catch (e) {
    log.warn("could not create the models directory:", e);
  }
}

/**
 * Where the app puts what it derives from those models (today: the label
 * embeddings behind Analyze). Deliberately outside `models/`: that directory
 * belongs to the user, and an app writing its own files into it makes "delete
 * the folder to remove the model" a less honest instruction than it should be.
 */
export function aiCacheDir(): string {
  return path.join(app.getPath("userData"), "ai-cache");
}

// --- Model ids ---
//
// A directory can hold several weight variants (fp32 next to quantized), and
// their embeddings are close but not equal — comparing one against the other
// returns a plausible number that means nothing. So a *variant* is the unit the
// app selects and the unit `meta_embeddings.model_id` records, and its id is the
// directory name and the variant joined by a colon.
//
// The colon is always present, so the fp32 variant (whose suffix is empty) is
// still unambiguous, and the id is parsed from the right — a directory name
// containing a colon parses correctly because a variant suffix never can.

const VARIANT_RE = /^[a-z0-9]*$/;

export function modelIdFor(dirName: string, variant: string): string {
  return `${dirName}:${variant}`;
}

export function parseModelId(
  id: string,
): { dirName: string; variant: string } | null {
  const i = id.lastIndexOf(":");
  if (i <= 0) return null;
  const dirName = id.slice(0, i);
  const variant = id.slice(i + 1);
  if (!VARIANT_RE.test(variant)) return null;
  if (dirName === "." || dirName === ".." || dirName.includes("/")) return null;
  if (path.sep !== "/" && dirName.includes(path.sep)) return null;
  return { dirName, variant };
}

/**
 * The directory holding a model id's files, or null when the id does not name
 * one. Ids reach this from `config.json`, which is an ordinary file the user can
 * edit, so the result is checked to be a direct child of the models folder
 * rather than trusted to be one.
 */
export function modelDir(id: string): string | null {
  const parsed = parseModelId(id);
  if (!parsed) return null;
  const dir = path.join(modelsDir(), parsed.dirName);
  return path.dirname(dir) === modelsDir() ? dir : null;
}

// --- Reading a model directory ---

const VISION_RE = /^onnx\/vision_model(?:_([a-z0-9]+))?\.onnx$/;
const TEXT_RE = /^onnx\/text_model(?:_([a-z0-9]+))?\.onnx$/;

/**
 * Cap on the entries examined per directory. A model directory holds a handful
 * of files; anything the size of a downloads folder is not one, and should be
 * rejected without walking all of it.
 */
const MAX_SCAN_ENTRIES = 2000;

interface ClipConfig {
  model_type?: string;
  projection_dim?: number;
  text_config?: { projection_dim?: number };
}

interface PreprocessorConfig {
  size?: { shortest_edge?: number; height?: number; width?: number } | number;
  crop_size?: { height?: number; width?: number } | number;
  image_mean?: number[];
  image_std?: number[];
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** A normalization triple is usable only if every term is finite — and, for the
 *  divisor, non-zero: `1 / 0` would turn a whole embedding into NaN, which no
 *  later step rejects. Anything else falls back to the CLIP defaults. */
function usableTriple(xs: unknown, nonZero: boolean): xs is number[] {
  return (
    Array.isArray(xs) &&
    xs.length === 3 &&
    xs.every(
      (x) =>
        typeof x === "number" && Number.isFinite(x) && (!nonZero || x !== 0),
    )
  );
}

/** Preprocessing parameters, forced into the range the app can allocate. */
function preprocessFrom(raw: PreprocessorConfig | null): PreprocessParams {
  const p = { ...CLIP_DEFAULT_PREPROCESS };
  if (!raw) return p;
  // crop_size wins: it is the square the graph actually takes, where `size` may
  // only be the shorter edge it was resized to first.
  const crop = raw.crop_size;
  const size = raw.size;
  const n =
    (typeof crop === "number" ? crop : crop?.height) ??
    (typeof size === "number" ? size : (size?.shortest_edge ?? size?.height));
  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    p.size = Math.min(
      MAX_PREPROCESS_SIZE,
      Math.max(MIN_PREPROCESS_SIZE, Math.round(n)),
    );
  }
  if (usableTriple(raw.image_mean, false)) {
    p.mean = [...raw.image_mean] as PreprocessParams["mean"];
  }
  if (usableTriple(raw.image_std, true)) {
    p.std = [...raw.image_std] as PreprocessParams["std"];
  }
  return p;
}

/**
 * List a candidate model directory, one level deep plus `onnx/` — the whole
 * shape of a transformers.js export. Paths are POSIX-style so the regexes above
 * read the same on Windows.
 *
 * Symlinks are followed. `huggingface_hub` lays a snapshot out as a directory of
 * links into a sibling `blobs/` folder, so refusing to follow them would reject
 * exactly the directories the documented way of obtaining a model produces.
 */
function scanDir(dir: string, depth = 0): ModelFile[] {
  const out: ModelFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.slice(0, MAX_SCAN_ENTRIES)) {
    const full = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    let size = 0;
    if (isFile || e.isSymbolicLink()) {
      // statSync follows the link; a dangling one drops out of the listing.
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      isDir = stat.isDirectory();
      isFile = stat.isFile();
      size = stat.size;
    }
    if (isDir) {
      if (depth >= 1) continue;
      for (const f of scanDir(full, depth + 1)) {
        out.push({ path: `${e.name}/${f.path}`, size: f.size });
      }
      continue;
    }
    if (isFile) out.push({ path: e.name, size });
  }
  return out;
}

/** Variants present for *both* graphs, keyed by suffix ("" = fp32). */
function pairedVariants(
  files: ModelFile[],
): Map<string, { vision: ModelFile; text: ModelFile }> {
  const vision = new Map<string, ModelFile>();
  const text = new Map<string, ModelFile>();
  for (const f of files) {
    const v = VISION_RE.exec(f.path);
    if (v) vision.set(v[1] ?? "", f);
    const t = TEXT_RE.exec(f.path);
    if (t) text.set(t[1] ?? "", f);
  }
  const out = new Map<string, { vision: ModelFile; text: ModelFile }>();
  for (const [variant, vf] of vision) {
    const tf = text.get(variant);
    if (tf) out.set(variant, { vision: vf, text: tf });
  }
  return out;
}

/** Why a directory is not a usable model, or null when it is one. */
export type ModelRejection =
  "not_found" | "no_config" | "no_tokenizer" | "no_onnx" | "no_dimension";

export interface LocalModelInfo {
  /** Directory name, which is the model's display name. */
  name: string;
  /** `model_type` from config.json ("clip", "siglip", …). */
  modelType: string | null;
  /** Non-null when the directory cannot be used, with a machine-readable reason. */
  unsupported: ModelRejection | null;
  /** Usable weight variants, best pick first. */
  variants: { id: string; variant: string; bytes: number }[];
}

/**
 * Read one directory and report what, if anything, it offers. Only the small
 * JSON files are opened — the ONNX graphs are sized, not parsed — so this stays
 * cheap enough to run over the whole models folder on every listing, which is
 * what lets the folder itself be the source of truth.
 */
export function inspectModelDir(dir: string): LocalModelInfo {
  const name = path.basename(dir);
  const files = scanDir(dir);
  if (files.length === 0)
    return { name, modelType: null, unsupported: "not_found", variants: [] };

  const names = new Set(files.map((f) => f.path));
  for (const aux of REQUIRED_AUX) {
    if (names.has(aux)) continue;
    const why = aux === "config.json" ? "no_config" : "no_tokenizer";
    return { name, modelType: null, unsupported: why, variants: [] };
  }
  const config = readJson<ClipConfig>(path.join(dir, "config.json"));
  const modelType = config?.model_type ?? null;

  const pairs = pairedVariants(files);
  if (pairs.size === 0)
    return { name, modelType, unsupported: "no_onnx", variants: [] };

  const dim = config?.projection_dim ?? config?.text_config?.projection_dim;
  if (!dim || !Number.isInteger(dim) || dim <= 0 || dim > MAX_DIM) {
    return { name, modelType, unsupported: "no_dimension", variants: [] };
  }

  // fp32 first, then quantized (the usual CPU pick), then the rest alphabetically.
  const order = (v: string) => (v === "" ? 0 : v === "quantized" ? 1 : 2);
  const variants = [...pairs.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([variant, p]) => ({
      id: modelIdFor(name, variant),
      variant,
      bytes: p.vision.size + p.text.size,
    }));
  return { name, modelType, unsupported: null, variants };
}

/**
 * Everything needed to load one variant, or null when the id no longer names a
 * usable one — the user may have moved or emptied the directory since it was
 * selected, which is an ordinary thing to have happened, not an error.
 */
export function describeModel(id: string): ModelDescriptor | null {
  const parsed = parseModelId(id);
  const dir = modelDir(id);
  if (!parsed || !dir) return null;
  const info = inspectModelDir(dir);
  if (info.unsupported) return null;
  if (!info.variants.some((v) => v.variant === parsed.variant)) return null;

  const config = readJson<ClipConfig>(path.join(dir, "config.json"));
  const dim = config?.projection_dim ?? config?.text_config?.projection_dim;
  if (!dim) return null;
  const suffix = parsed.variant ? `_${parsed.variant}` : "";
  return {
    id,
    name: info.name,
    variant: parsed.variant,
    dim,
    vision: `onnx/vision_model${suffix}.onnx`,
    text: `onnx/text_model${suffix}.onnx`,
    preprocess: preprocessFrom(
      readJson<PreprocessorConfig>(path.join(dir, "preprocessor_config.json")),
    ),
  };
}

/**
 * Every usable variant of every directory in the models folder, one row each.
 *
 * Directories that are not models are skipped in silence: the folder is the
 * user's, and a stray `.DS_Store` or a half-extracted archive is not something
 * to complain about.
 */
export function listModels(): AiModelInfo[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(modelsDir());
  } catch {
    return [];
  }
  const out: AiModelInfo[] = [];
  for (const name of names.sort()) {
    const dir = path.join(modelsDir(), name);
    const info = inspectModelDir(dir);
    if (info.unsupported) continue;
    const config = readJson<ClipConfig>(path.join(dir, "config.json"));
    const dim = config?.projection_dim ?? config?.text_config?.projection_dim;
    if (!dim) continue;
    let addedAt = 0;
    try {
      addedAt = Math.floor(fs.statSync(dir).mtimeMs / 1000);
    } catch {
      /* the directory answered readdir a moment ago; a race is not worth a throw */
    }
    for (const v of info.variants) {
      out.push({
        id: v.id,
        name: info.name,
        variant: v.variant,
        dim,
        bytes: v.bytes,
        installedAt: addedAt,
      });
    }
  }
  return out;
}

/**
 * Delete a whole model directory, every variant of it at once.
 *
 * Addressed by directory rather than by model id because that is what is on
 * disk: "remove the quantized variant" would mean reaching into a folder the
 * user assembled and deleting files out of it.
 */
export async function removeModelDir(dirName: string): Promise<void> {
  const dir = modelDir(modelIdFor(dirName, ""));
  if (!dir) throw new Error(`invalid model directory: ${dirName}`);
  await fsp.rm(dir, { recursive: true, force: true });
  log.info(`removed model directory ${dirName}`);
}
