// CLIP-family inference on onnxruntime-node: one vision graph (pixels →
// embedding) and one text graph (token ids → embedding) from a model the user
// supplied (see modelStore). Both embeddings are L2-normalized here, so every
// consumer can treat cosine similarity as a dot product.
//
// Image decoding goes through the bundled ffmpeg rather than a JS image
// library: it already handles every container the scanner accepts, and a
// video frame and a still image come out of the same command.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as ort from "onnxruntime-node";
import { Tokenizer } from "@huggingface/tokenizers";
import { FFMPEG } from "../ffmpeg-paths.js";
import { scopedLog } from "../logger.js";
import {
  describeModel,
  modelDir,
  type PreprocessParams,
} from "./modelStore.js";
import type { Kind } from "../types.js";

const log = scopedLog("ai:clip");
const execFileAsync = promisify(execFile);

/** Frames sampled per video, spread over its duration (edges skipped). */
export const VIDEO_SAMPLE_FRAMES = 6;
/** Fallback text length when tokenizer_config.json does not say (CLIP's context). */
const DEFAULT_MAX_TEXT_TOKENS = 77;
const FFMPEG_TIMEOUT_MS = 60_000;

export interface LoadedClip {
  id: string;
  dim: number;
  /** Execution provider the sessions ended up on. */
  backend: string;
}

/** Weight variants that carry integer-quantized ops. */
const QUANTIZED_VARIANT = /quantized|int8|uint8|q4|bnb4/;

/**
 * Providers to try, best first. Whatever onnxruntime rejects falls through.
 * Integer-quantized graphs go CPU-first: their quantized ops have no GPU
 * kernels and fall back per node, which measured slower than plain CPU.
 */
function providerCandidates(variant: string): string[] {
  const bundled = new Set(
    ort
      .listSupportedBackends()
      .filter((b) => b.bundled)
      .map((b) => b.name),
  );
  const gpu: string[] = [];
  if (process.platform === "win32") gpu.push("dml");
  if (process.platform === "darwin") gpu.push("coreml");
  gpu.push("webgpu");
  const wanted = QUANTIZED_VARIANT.test(variant)
    ? ["cpu", ...gpu]
    : [...gpu, "cpu"];
  return wanted.filter((p) => bundled.has(p));
}

/**
 * Convert ffmpeg's packed rgb24 frame to the planar, normalized float tensor
 * CLIP expects (CHW, (x/255 - mean) / std).
 */
export function rgbToTensor(
  rgb: Uint8Array,
  p: PreprocessParams,
): Float32Array {
  const n = p.size * p.size;
  if (rgb.length < n * 3) throw new Error("short frame buffer");
  const out = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) {
    const mean = p.mean[c];
    const inv = 1 / p.std[c];
    for (let i = 0; i < n; i++)
      out[c * n + i] = (rgb[i * 3 + c] / 255 - mean) * inv;
  }
  return out;
}

export function l2Normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

/** Seek positions for a video: evenly spaced, avoiding the (often black) first and last 5%. */
export function sampleTimes(
  duration: number,
  count = VIDEO_SAMPLE_FRAMES,
): number[] {
  if (!(duration > 0)) return [0];
  const n = Math.max(1, Math.min(count, Math.ceil(duration)));
  const start = duration * 0.05;
  const span = duration * 0.9;
  return Array.from({ length: n }, (_, i) => start + (span * (i + 0.5)) / n);
}

/** Half the cores: leave room for ffmpeg decoding and the UI. */
function intraOpThreads(): number {
  return Math.max(1, Math.floor(os.cpus().length / 2));
}

export class ClipModel {
  private vision: ort.InferenceSession | null = null;
  private text: ort.InferenceSession | null = null;
  private tokenizer: Tokenizer | null = null;
  private maxTokens = DEFAULT_MAX_TEXT_TOKENS;
  private padId = 0;
  private pre: PreprocessParams;
  private visionInput = "pixel_values";
  private textInputs: string[] = ["input_ids"];
  readonly info: LoadedClip;

  private constructor(
    readonly id: string,
    readonly dim: number,
    pre: PreprocessParams,
    backend: string,
  ) {
    this.pre = pre;
    this.info = { id, dim, backend };
  }

  static async load(id: string): Promise<ClipModel> {
    const m = describeModel(id);
    const dir = modelDir(id);
    if (!m || !dir) throw new Error(`model not installed: ${id}`);
    const tokenizerJson = JSON.parse(
      fs.readFileSync(path.join(dir, "tokenizer.json"), "utf8"),
    ) as object;
    let tokenizerConfig: Record<string, unknown> = {};
    try {
      tokenizerConfig = JSON.parse(
        fs.readFileSync(path.join(dir, "tokenizer_config.json"), "utf8"),
      ) as Record<string, unknown>;
    } catch {
      /* optional */
    }

    let lastErr: unknown = null;
    for (const ep of providerCandidates(m.variant)) {
      try {
        const opts: ort.InferenceSession.SessionOptions = {
          executionProviders: [ep],
          graphOptimizationLevel: "all",
          // The binding rejects an explicit `undefined` here, so only set it for CPU.
          ...(ep === "cpu" ? { intraOpNumThreads: intraOpThreads() } : {}),
        };
        const vision = await ort.InferenceSession.create(
          path.join(dir, m.vision),
          opts,
        );
        const text = await ort.InferenceSession.create(
          path.join(dir, m.text),
          opts,
        );
        const model = new ClipModel(id, m.dim, m.preprocess, ep);
        model.vision = vision;
        model.text = text;
        model.visionInput = vision.inputNames[0] ?? "pixel_values";
        model.textInputs = [...text.inputNames];
        model.tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
        const maxLen = tokenizerConfig.model_max_length;
        if (typeof maxLen === "number" && maxLen > 0 && maxLen < 100_000)
          model.maxTokens = maxLen;
        const padToken = tokenizerConfig.pad_token;
        const padId =
          typeof padToken === "string"
            ? model.tokenizer.token_to_id(padToken)
            : undefined;
        // CLIP pads with EOS; when the config names no pad token, fall back to
        // whatever the encoder puts last (EOS for CLIP, also EOS for SigLIP).
        model.padId = padId ?? model.tokenizer.encode("a").ids.at(-1) ?? 0;
        log.info(
          `loaded ${id} on ${ep} (dim=${m.dim}, maxTokens=${model.maxTokens})`,
        );
        return model;
      } catch (e) {
        lastErr = e;
        log.warn(`provider ${ep} failed for ${id}, trying next:`, e);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async close(): Promise<void> {
    await this.vision?.release();
    await this.text?.release();
    this.vision = null;
    this.text = null;
  }

  /** Decode one frame of `file` (at `sec` for videos) into the model's input size. */
  private async decodeFrame(
    file: string,
    sec: number | null,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const s = this.pre.size;
    // `-protocol_whitelist file` keeps a crafted playlist-style input from
    // making the decoder reach for a URL. The app promises it opens no external
    // connection, and a promise that depends on what is in the library is not
    // one worth making.
    const args = ["-v", "error", "-nostdin", "-protocol_whitelist", "file"];
    if (sec != null) args.push("-ss", sec.toFixed(3));
    args.push(
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      `scale=${s}:${s}:force_original_aspect_ratio=increase,crop=${s}:${s}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    );
    const { stdout } = await execFileAsync(FFMPEG, args, {
      encoding: "buffer",
      maxBuffer: s * s * 3 + 1024,
      timeout: FFMPEG_TIMEOUT_MS,
      signal,
    });
    return new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.length);
  }

  private async runVision(pixels: Float32Array): Promise<Float32Array> {
    if (!this.vision) throw new Error("model closed");
    const s = this.pre.size;
    const input = new ort.Tensor("float32", pixels, [1, 3, s, s]);
    const out = await this.vision.run({ [this.visionInput]: input });
    const name =
      this.vision.outputNames.find((n) => /embed/.test(n)) ??
      this.vision.outputNames[0];
    return l2Normalize(new Float32Array(out[name].data as Float32Array));
  }

  /**
   * Embed a file: the single frame of an image, or the mean of several frames
   * for a video (then re-normalized). Frames that fail to decode are skipped;
   * the result is null only when none decoded.
   */
  async embedFile(
    file: string,
    kind: Kind,
    duration: number | null,
    signal?: AbortSignal,
  ): Promise<Float32Array | null> {
    const times: (number | null)[] =
      kind === "video" ? sampleTimes(duration ?? 0) : [null];
    const acc = new Float32Array(this.dim);
    let n = 0;
    for (const t of times) {
      if (signal?.aborted) return null;
      let rgb: Uint8Array;
      try {
        rgb = await this.decodeFrame(file, t, signal);
      } catch (e) {
        if (signal?.aborted) return null;
        log.warn(`frame decode failed for ${file} @${t ?? "still"}:`, e);
        continue;
      }
      const emb = await this.runVision(rgbToTensor(rgb, this.pre));
      // config.json's projection_dim is a claim about the graph, not a fact.
      // Believing a wrong one would sum `undefined` into NaN and store it as a
      // perfectly ordinary-looking vector.
      if (emb.length !== this.dim) {
        throw new Error(
          `vision output has ${emb.length} dimensions, config.json says ${this.dim}`,
        );
      }
      for (let i = 0; i < this.dim; i++) acc[i] += emb[i];
      n++;
    }
    return n === 0 ? null : l2Normalize(acc);
  }

  /** Embed texts in one batch. Each row is L2-normalized. */
  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    if (!this.text || !this.tokenizer) throw new Error("model closed");
    if (texts.length === 0) return [];
    const encoded = texts.map((t) => {
      const ids = this.tokenizer!.encode(t).ids;
      if (ids.length <= this.maxTokens) return ids;
      // Keep the trailing special token (EOS) when truncating.
      return [...ids.slice(0, this.maxTokens - 1), ids[ids.length - 1]];
    });
    const L = Math.max(...encoded.map((e) => e.length));
    const B = encoded.length;
    const ids = new BigInt64Array(B * L).fill(BigInt(this.padId));
    const mask = new BigInt64Array(B * L);
    encoded.forEach((e, i) =>
      e.forEach((id, j) => {
        ids[i * L + j] = BigInt(id);
        mask[i * L + j] = 1n;
      }),
    );
    const feeds: Record<string, ort.Tensor> = {};
    for (const name of this.textInputs) {
      if (name === "attention_mask")
        feeds[name] = new ort.Tensor("int64", mask, [B, L]);
      else if (name === "input_ids")
        feeds[name] = new ort.Tensor("int64", ids, [B, L]);
    }
    const out = await this.text.run(feeds);
    const name =
      this.text.outputNames.find((n) => /embed/.test(n)) ??
      this.text.outputNames[0];
    const data = out[name].data as Float32Array;
    const dim = out[name].dims[1];
    return encoded.map((_, i) =>
      l2Normalize(new Float32Array(data.subarray(i * dim, (i + 1) * dim))),
    );
  }
}

/** Execution providers onnxruntime bundles on this machine (for the status line). */
export function availableBackends(): string[] {
  try {
    return ort
      .listSupportedBackends()
      .filter((b) => b.bundled)
      .map((b) => b.name);
  } catch {
    return [];
  }
}
