// AiService without a model loaded: configuration, model selection against the
// models folder, and the calls that must degrade quietly when nothing is
// selected. Loading a real ONNX graph is out of scope for a unit test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import { insertFile, newDb } from "./helpers.js";
import { addManualTag, fileTags, metaKeyOf } from "../tags.js";
import { AI_TAG_NAMESPACE } from "../../../shared/tags.js";

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { AiService } = await import("../ai/aiService.js");
const { DEFAULT_AI_SETTINGS, loadConfig, updateConfig } =
  await import("../appConfig.js");
const { modelsDir } = await import("../ai/modelStore.js");
const {
  aiTagSignature,
  applyScoredTagsByKey,
  retagSignature,
  setRetagSignature,
} = await import("../ai/aiTags.js");
const { upsertEmbedding } = await import("../ai/embeddings.js");
type CoreTarget = { id: string; core: Core };
const { MAX_AI_VOCABULARY } = await import("../../../shared/ipc/schema.js");
const { Workspaces } = await import("../workspaces.js");

/** A directory that passes inspection; the graphs are never opened here. */
function writeModel(name: string): void {
  const dir = path.join(modelsDir(), name);
  fs.mkdirSync(path.join(dir, "onnx"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ model_type: "clip", projection_dim: 512 }),
  );
  fs.writeFileSync(path.join(dir, "tokenizer.json"), "{}");
  fs.writeFileSync(path.join(dir, "onnx/vision_model.onnx"), "");
  fs.writeFileSync(path.join(dir, "onnx/text_model.onnx"), "");
}

let emitted: unknown[] = [];
let ai: InstanceType<typeof AiService>;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-ai-"));
  fs.mkdirSync(modelsDir(), { recursive: true });
  emitted = [];
  ai = new AiService((p) => emitted.push(p));
});

afterEach(async () => {
  await ai.dispose();
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("status", () => {
  it("reports the models folder and what is in it", () => {
    let s = ai.status([]);
    expect(s.modelsDir).toBe(modelsDir());
    expect(s.models).toEqual([]);
    expect(s.activeModelId).toBeNull();
    expect(s.job).toBeNull();
    expect(s.pending).toBe(0);

    // No reload call: a model dropped into the folder shows up on the next status.
    writeModel("clip");
    s = ai.status([]);
    expect(s.models.map((m) => m.id)).toEqual(["clip:"]);
  });

  it("treats a selected model whose folder is gone as no model", async () => {
    writeModel("clip");
    await ai.selectModel("clip:", []);
    expect(ai.activeModelId).toBe("clip:");

    fs.rmSync(path.join(modelsDir(), "clip"), { recursive: true });
    expect(ai.activeModelId).toBeNull();
    expect(ai.status([]).activeModelId).toBeNull();
  });
});

describe("model selection", () => {
  it("persists a model that exists, and clears it again", async () => {
    writeModel("clip");
    await ai.selectModel("clip:", []);
    expect(loadConfig().ai.activeModelId).toBe("clip:");
    await ai.selectModel(null, []);
    expect(loadConfig().ai.activeModelId).toBeNull();
  });

  it("refuses an id with no model behind it", async () => {
    await expect(ai.selectModel("nope:", [])).rejects.toThrow(/not found/);
    // Hand-edited config.json is where a traversal attempt would come from.
    await expect(ai.selectModel("../../etc:", [])).rejects.toThrow(/not found/);
    expect(loadConfig().ai.activeModelId).toBeNull();
  });
});

describe("auto-index after a scan", () => {
  const core = {} as Core;
  /** Job starts and ends, as reported on ai:progress. */
  const jobEvents = () =>
    (emitted as { job: { workspaceId: string | null } | null }[]).map((e) =>
      e.job ? "start" : "end",
    );

  async function withAutoIndex(): Promise<void> {
    writeModel("clip");
    await ai.selectModel("clip:", []);
    ai.setSettings({ autoIndex: true });
  }

  it("does nothing unless auto-index is on and a model is selected", () => {
    ai.onScanFinished({ wsId: "a", core, aborted: false, failed: false });
    expect(emitted).toEqual([]);
  });

  it("does not index after a scan that was aborted or failed", async () => {
    await withAutoIndex();
    ai.onScanFinished({ wsId: "a", core, aborted: true, failed: false });
    ai.onScanFinished({ wsId: "b", core, aborted: false, failed: true });
    expect(emitted).toEqual([]);
  });

  it("queues a workspace whose scan ends while a job runs, and runs it afterwards", async () => {
    await withAutoIndex();
    // The model directory holds empty graphs, so each run fails at load — which
    // is fine: what is under test is that the second run happens at all.
    ai.onScanFinished({ wsId: "a", core, aborted: false, failed: false });
    expect(ai.isIndexing).toBe(true);
    ai.onScanFinished({ wsId: "b", core, aborted: false, failed: false });

    await vi.waitFor(() =>
      expect(jobEvents()).toEqual(["start", "end", "start", "end"]),
    );
    expect(ai.isIndexing).toBe(false);
  });

  it("drops a queued workspace that is being removed", async () => {
    await withAutoIndex();
    ai.onScanFinished({ wsId: "a", core, aborted: false, failed: false });
    ai.onScanFinished({ wsId: "b", core, aborted: false, failed: false });
    ai.forgetWorkspace("b");
    await ai.stopJob();
    await vi.waitFor(() => expect(ai.isIndexing).toBe(false));
    expect(jobEvents()).toEqual(["start", "end"]);
  });

  it("starts nothing once disposed", async () => {
    await withAutoIndex();
    await ai.dispose();
    ai.onScanFinished({ wsId: "a", core, aborted: false, failed: false });
    expect(emitted).toEqual([]);
    expect(() => ai.index([])).toThrow(/shutting down/);
  });
});

describe("switching models", () => {
  it("clears the AI tags of every workspace and reports how many", async () => {
    const { db, rootId } = newDb();
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const key = metaKeyOf(db, a)!;
    applyScoredTagsByKey(db, key, [
      { namespace: AI_TAG_NAMESPACE, name: "cat", score: 0.9 },
      { namespace: AI_TAG_NAMESPACE, name: "night", score: 0.4 },
    ]);
    addManualTag(db, a, "keep me");
    setRetagSignature(db, "whatever");
    const cores = [{ id: "w", core: { db } as Core }];

    writeModel("clip");
    expect(await ai.selectModel("clip:", cores)).toBe(2);

    // Only the AI tags: a tag the user typed is theirs, not the model's.
    expect(fileTags(db, a).map((t) => t.name)).toEqual(["keep me"]);
    // And the tags are marked as needing a re-tag pass.
    expect(retagSignature(db)).toBe("");
    db.close();
  });

  it("refuses the switch when a workspace's tags cannot be cleared", async () => {
    writeModel("clip");
    const { db } = newDb();
    db.close(); // stands in for a workspace whose database is unusable
    const cores = [{ id: "w", core: { db } as Core }];

    await expect(ai.selectModel("clip:", cores)).rejects.toThrow(
      /could not clear the AI tags/,
    );
    // Nothing was selected: a library half in one model's tags and half in
    // another's is the state this refusal exists to prevent.
    expect(loadConfig().ai.activeModelId).toBeNull();
    expect(ai.activeModelId).toBeNull();
  });
});

describe("re-tagging after a settings change", () => {
  function workspace(): { cores: CoreTarget[]; db: DB } {
    const { db, rootId } = newDb();
    const a = insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    upsertEmbedding(db, metaKeyOf(db, a)!, "clip:", new Float32Array([1, 0]));
    return { cores: [{ id: "w", core: { db } as Core }], db };
  }

  it("reports nothing pending until a workspace holds vectors", async () => {
    writeModel("clip");
    await ai.selectModel("clip:", []);
    const { db, rootId } = newDb();
    insertFile(db, rootId, { relPath: "a.jpg", kind: "image" });
    const cores = [{ id: "w", core: { db } as Core }];
    // No vectors yet: there is nothing whose tags could be out of date.
    expect(ai.status(cores).retagPending).toBe(false);
    db.close();
  });

  it("reports the tags as out of date once the vocabulary changes", async () => {
    writeModel("clip");
    await ai.selectModel("clip:", []);
    const { cores, db } = workspace();
    expect(ai.status(cores).retagPending).toBe(true);

    // Standing in for a completed re-tag pass.
    setRetagSignature(
      db,
      aiTagSignature(
        "clip:",
        ai.settings().vocabulary,
        ai.settings().threshold,
      ),
    );
    expect(ai.status(cores).retagPending).toBe(false);

    ai.setSettings({ threshold: 0.6 });
    expect(ai.status(cores).retagPending).toBe(true);
    ai.setSettings({ threshold: DEFAULT_AI_SETTINGS.threshold });
    expect(ai.status(cores).retagPending).toBe(false);

    ai.addVocabulary(["sunset"]);
    expect(ai.status(cores).retagPending).toBe(true);
    db.close();
  });
});

describe("without a model", () => {
  it("refuses to start an index run rather than starting one that fails", () => {
    expect(() => ai.index([])).toThrow(/no active model/);
    expect(emitted).toEqual([]);
    expect(ai.isIndexing).toBe(false);
  });

  it("answers searches with nothing instead of an error", async () => {
    expect(await ai.search("a cat", [])).toEqual([]);
    const core = { db: {} } as Core;
    expect(ai.similar({ workspaceId: "w", id: 1, core }, [])).toEqual([]);
  });
});

describe("settings", () => {
  it("starts from the defaults", () => {
    expect(ai.settings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("patches only what is given, normalizing the vocabulary", () => {
    ai.setSettings({ vocabulary: [" cat ", "Cat", "dog:shiba", ""] });
    ai.setSettings({ threshold: 0.5 });
    expect(ai.settings()).toEqual({
      vocabulary: ["cat", "dog shiba"],
      threshold: 0.5,
      autoIndex: DEFAULT_AI_SETTINGS.autoIndex,
    });
    expect(ai.addVocabulary(["dog shiba", "bird"])).toEqual([
      "cat",
      "dog shiba",
      "bird",
    ]);
  });

  it("returns what it stored, and caps an append at the vocabulary limit", () => {
    expect(ai.setSettings({ vocabulary: [" Cat "] }).vocabulary).toEqual([
      "Cat",
    ]);
    const full = Array.from({ length: MAX_AI_VOCABULARY }, (_, i) => `w${i}`);
    ai.setSettings({ vocabulary: full });
    const merged = ai.addVocabulary(["one more"]);
    expect(merged).toHaveLength(MAX_AI_VOCABULARY);
    // What was returned is what a reload sees.
    expect(loadConfig().ai.settings.vocabulary).toEqual(merged);
  });

  it("survives a workspace change written from a stale in-memory config", () => {
    const ws = new Workspaces();
    ai.setSettings({ threshold: 0.42, autoIndex: true });
    // logo is written the same way, independently of Workspaces.
    updateConfig((c) => ({ ...c, logo: "enso" }));
    // Workspaces holds the config it loaded at construction; persisting a
    // workspace change must not write that stale copy of the AI section back.
    ws.add(fs.mkdtempSync(path.join(userData, "root-")));
    expect(loadConfig().ai.settings).toMatchObject({
      threshold: 0.42,
      autoIndex: true,
    });
    expect(loadConfig().logo).toBe("enso");
    expect(loadConfig().roots).toHaveLength(1);
  });

  it("reads a hand-edited config field by field", () => {
    updateConfig((c) => c);
    const file = path.join(userData, "config.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    raw.ai = {
      activeModelId: 42,
      settings: {
        vocabulary: ["ok", "x".repeat(1000), 7],
        threshold: 5,
        autoIndex: "yes",
      },
    };
    fs.writeFileSync(file, JSON.stringify(raw));

    // An over-long entry costs that entry, not the rest of the section.
    expect(loadConfig().ai).toEqual({
      activeModelId: null,
      settings: {
        vocabulary: ["ok"],
        threshold: 0.95,
        autoIndex: DEFAULT_AI_SETTINGS.autoIndex,
      },
    });
  });
});
