// The on-disk model store. There is no import step: a directory dropped into
// the models folder is the installation, so everything here is about what the
// app makes of the directories it finds.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const {
  aiCacheDir,
  describeModel,
  inspectModelDir,
  listModels,
  modelDir,
  modelIdFor,
  modelsDir,
  parseModelId,
  removeModelDir,
} = await import("../ai/modelStore.js");

let tmp = "";

/** Write a file into a model directory under the models folder. */
function write(model: string, rel: string, body: string | Buffer): void {
  const file = path.join(modelsDir(), model, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** The minimum a directory needs to count as a model. */
function writeUsableModel(model = "clip-vit-base-patch32"): string {
  write(
    model,
    "config.json",
    JSON.stringify({ model_type: "clip", projection_dim: 512 }),
  );
  write(model, "tokenizer.json", "{}");
  write(model, "onnx/vision_model.onnx", Buffer.alloc(64));
  write(model, "onnx/text_model.onnx", Buffer.alloc(32));
  return model;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-models-"));
  userData = path.join(tmp, "userData");
  fs.mkdirSync(modelsDir(), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("model ids", () => {
  it("round-trips a directory name and a variant", () => {
    expect(parseModelId(modelIdFor("clip", ""))).toEqual({
      dirName: "clip",
      variant: "",
    });
    expect(parseModelId(modelIdFor("clip", "quantized"))).toEqual({
      dirName: "clip",
      variant: "quantized",
    });
  });

  it("parses from the right, so a colon in the directory name survives", () => {
    expect(parseModelId("a:b:quantized")).toEqual({
      dirName: "a:b",
      variant: "quantized",
    });
  });

  it("refuses an id that would escape the models folder", () => {
    // config.json is an ordinary file the user can edit, so these do arrive.
    expect(modelDir("../evil:")).toBeNull();
    expect(modelDir("..:")).toBeNull();
    expect(modelDir("a/b:")).toBeNull();
    expect(modelDir("no-colon")).toBeNull();
    expect(modelDir("clip:")).toBe(path.join(modelsDir(), "clip"));
  });

  it("keeps its cache out of the folder the user owns", () => {
    expect(path.dirname(aiCacheDir())).toBe(path.dirname(modelsDir()));
    expect(aiCacheDir()).not.toBe(modelsDir());
  });
});

describe("inspectModelDir", () => {
  const dirOf = (model: string) => path.join(modelsDir(), model);

  it("rejects a directory that does not exist or is empty", () => {
    expect(inspectModelDir(dirOf("nope")).unsupported).toBe("not_found");
    fs.mkdirSync(dirOf("empty"));
    expect(inspectModelDir(dirOf("empty")).unsupported).toBe("not_found");
  });

  it("names the missing piece rather than just failing", () => {
    const m = "partial";
    write(m, "onnx/vision_model.onnx", Buffer.alloc(8));
    write(m, "onnx/text_model.onnx", Buffer.alloc(8));
    expect(inspectModelDir(dirOf(m)).unsupported).toBe("no_config");

    write(m, "config.json", JSON.stringify({ model_type: "clip" }));
    expect(inspectModelDir(dirOf(m)).unsupported).toBe("no_tokenizer");

    write(m, "tokenizer.json", "{}");
    // The config parses but says nothing about the embedding width.
    expect(inspectModelDir(dirOf(m)).unsupported).toBe("no_dimension");

    write(
      m,
      "config.json",
      JSON.stringify({ model_type: "clip", projection_dim: 512 }),
    );
    expect(inspectModelDir(dirOf(m)).unsupported).toBeNull();
  });

  it("requires both graphs of a variant, never one on its own", () => {
    const m = "one-sided";
    write(
      m,
      "config.json",
      JSON.stringify({ model_type: "clip", projection_dim: 512 }),
    );
    write(m, "tokenizer.json", "{}");
    write(m, "onnx/vision_model.onnx", Buffer.alloc(8));
    expect(inspectModelDir(dirOf(m)).unsupported).toBe("no_onnx");
  });

  it("lists the paired variants, fp32 first and quantized next", () => {
    const m = writeUsableModel();
    write(m, "onnx/vision_model_quantized.onnx", Buffer.alloc(16));
    write(m, "onnx/text_model_quantized.onnx", Buffer.alloc(8));
    write(m, "onnx/vision_model_bnb4.onnx", Buffer.alloc(4));
    write(m, "onnx/text_model_bnb4.onnx", Buffer.alloc(4));
    // No vision counterpart: this one must not become an offered variant.
    write(m, "onnx/text_model_fp16.onnx", Buffer.alloc(4));

    const info = inspectModelDir(dirOf(m));
    expect(info.name).toBe(m);
    expect(info.modelType).toBe("clip");
    expect(info.variants).toEqual([
      { id: `${m}:`, variant: "", bytes: 96 },
      { id: `${m}:quantized`, variant: "quantized", bytes: 24 },
      { id: `${m}:bnb4`, variant: "bnb4", bytes: 8 },
    ]);
  });

  it("reads a directory of symlinks, as huggingface_hub lays a snapshot out", () => {
    // blobs/ holds the real files; the snapshot directory is links into it.
    const blobs = path.join(tmp, "blobs");
    fs.mkdirSync(path.join(blobs, "onnx"), { recursive: true });
    const m = "snapshot";
    const blob = (rel: string, body: string | Buffer) => {
      fs.writeFileSync(path.join(blobs, rel), body);
      const link = path.join(modelsDir(), m, rel);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(path.join(blobs, rel), link);
    };
    blob(
      "config.json",
      JSON.stringify({ model_type: "clip", projection_dim: 512 }),
    );
    blob("tokenizer.json", "{}");
    blob("onnx/vision_model.onnx", Buffer.alloc(64));
    blob("onnx/text_model.onnx", Buffer.alloc(32));

    const info = inspectModelDir(dirOf(m));
    expect(info.unsupported).toBeNull();
    expect(info.variants).toEqual([{ id: `${m}:`, variant: "", bytes: 96 }]);
  });

  it("refuses an embedding width no allocation should follow", () => {
    const m = "huge";
    write(
      m,
      "config.json",
      JSON.stringify({ model_type: "clip", projection_dim: 1e9 }),
    );
    write(m, "tokenizer.json", "{}");
    write(m, "onnx/vision_model.onnx", Buffer.alloc(8));
    write(m, "onnx/text_model.onnx", Buffer.alloc(8));
    expect(inspectModelDir(dirOf(m)).unsupported).toBe("no_dimension");
  });
});

describe("listModels", () => {
  it("lists nothing when the models folder has never been created", () => {
    fs.rmSync(modelsDir(), { recursive: true, force: true });
    expect(listModels()).toEqual([]);
  });

  it("returns one row per usable variant", () => {
    const m = writeUsableModel();
    write(m, "onnx/vision_model_quantized.onnx", Buffer.alloc(16));
    write(m, "onnx/text_model_quantized.onnx", Buffer.alloc(8));

    const listed = listModels();
    expect(listed.map((x) => x.id)).toEqual([`${m}:`, `${m}:quantized`]);
    expect(listed[0]).toMatchObject({ name: m, variant: "", dim: 512 });
    expect(listed[0].bytes).toBe(96);
    expect(listed[0].installedAt).toBeGreaterThan(0);
  });

  it("skips whatever else is sitting in the folder, without complaining", () => {
    const m = writeUsableModel();
    fs.writeFileSync(path.join(modelsDir(), ".DS_Store"), "junk");
    fs.mkdirSync(path.join(modelsDir(), "half-extracted"));
    write("half-extracted", "config.json", "not json at all");

    expect(listModels().map((x) => x.name)).toEqual([m]);
  });

  it("removes a model directory with every variant in it", async () => {
    const m = writeUsableModel();
    write(m, "onnx/vision_model_quantized.onnx", Buffer.alloc(16));
    write(m, "onnx/text_model_quantized.onnx", Buffer.alloc(8));
    expect(listModels()).toHaveLength(2);

    await removeModelDir(m);
    expect(listModels()).toEqual([]);
    expect(fs.existsSync(path.join(modelsDir(), m))).toBe(false);
  });

  it("refuses to remove anything outside the models folder", async () => {
    await expect(removeModelDir("../userData")).rejects.toThrow(/invalid/);
    expect(fs.existsSync(userData)).toBe(true);
  });
});

describe("describeModel", () => {
  it("resolves the graphs of the requested variant", () => {
    const m = writeUsableModel();
    write(m, "onnx/vision_model_quantized.onnx", Buffer.alloc(16));
    write(m, "onnx/text_model_quantized.onnx", Buffer.alloc(8));

    expect(describeModel(`${m}:`)).toMatchObject({
      name: m,
      variant: "",
      dim: 512,
      vision: "onnx/vision_model.onnx",
      text: "onnx/text_model.onnx",
    });
    expect(describeModel(`${m}:quantized`)).toMatchObject({
      variant: "quantized",
      vision: "onnx/vision_model_quantized.onnx",
      text: "onnx/text_model_quantized.onnx",
    });
  });

  it("returns null once the directory is gone or no longer offers the variant", () => {
    const m = writeUsableModel();
    expect(describeModel(`${m}:quantized`)).toBeNull();
    fs.rmSync(path.join(modelsDir(), m), { recursive: true });
    // Selecting a model and then deleting its folder is an ordinary thing to
    // have done, so this is a null rather than a throw.
    expect(describeModel(`${m}:`)).toBeNull();
  });

  it("falls back to the CLIP normalization when no preprocessor config is present", () => {
    const m = writeUsableModel();
    expect(describeModel(`${m}:`)?.preprocess).toEqual({
      size: 224,
      mean: [0.48145466, 0.4578275, 0.40821073],
      std: [0.26862954, 0.26130258, 0.27577711],
    });
  });

  it("takes the crop size and normalization from preprocessor_config.json", () => {
    const m = writeUsableModel();
    write(
      m,
      "preprocessor_config.json",
      JSON.stringify({
        crop_size: { height: 336, width: 336 },
        size: { shortest_edge: 384 },
        image_mean: [0.5, 0.5, 0.5],
        image_std: [0.5, 0.5, 0.5],
      }),
    );
    // crop_size wins over size: it is the resolution the graph actually takes.
    expect(describeModel(`${m}:`)?.preprocess).toEqual({
      size: 336,
      mean: [0.5, 0.5, 0.5],
      std: [0.5, 0.5, 0.5],
    });
  });

  it("ignores preprocessing numbers that would break the pipeline", () => {
    const m = writeUsableModel();
    write(
      m,
      "preprocessor_config.json",
      JSON.stringify({
        // A size this large would ask for a multi-gigabyte frame buffer, and a
        // zero divisor would turn every embedding into NaN.
        crop_size: 100000,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [0, 0.5, 0.5],
      }),
    );
    expect(describeModel(`${m}:`)?.preprocess).toEqual({
      size: 1024,
      mean: [0.5, 0.5, 0.5],
      std: [0.26862954, 0.26130258, 0.27577711],
    });
  });
});
