import { ensureModelsDir, modelsDir } from "../core/ai/modelStore.js";
import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";
import {
  coreById,
  ensureFileInsideRoot,
  openDetached,
  scopedCores,
} from "./helpers.js";

export function registerAiHandlers(ctx: IpcContext): void {
  const { ws, ai } = ctx;
  // Same scope rule as history and the tag catalog: a collection is a file set,
  // not a scope, so status, indexing and search cover every workspace while one
  // is active.
  const cores = () => scopedCores(ws);

  handle("ai_status", () => ai.status(cores()));
  handle("ai_models_open", () => {
    // Created at startup, but the user may have deleted it since; opening a
    // path that does not exist does nothing at all, which reads as a dead button.
    ensureModelsDir();
    openDetached(modelsDir());
  });
  // Every workspace, not the scoped ones: the tags being cleared are the old
  // model's wherever they are, and the view that happens to be open is beside
  // the point.
  handle("ai_model_select", ({ id }) => ai.selectModel(id, ws.allCores()));
  // Echoes the stored settings, normalized, so the renderer settles on main's value.
  handle("ai_settings_set", (patch) => ai.setSettings(patch));
  handle("ai_index_start", ({ retagOnly }) => {
    ai.index(cores(), { retagOnly });
  });
  // Resolves once the job has actually stopped, so starting another right
  // after does not trip over the one still winding down.
  handle("ai_job_cancel", () => ai.stopJob());
  handle("ai_search", ({ text, limit }) => ai.search(text, cores(), limit));
  handle("ai_similar", ({ id, workspaceId, limit }) =>
    ai.similar(
      { workspaceId, id, core: coreById(ws, workspaceId) },
      cores(),
      limit,
    ),
  );
  handle("ai_analyze_file", ({ id, workspaceId }) => {
    const core = coreById(ws, workspaceId);
    // The file is handed to ffmpeg, so it goes through the same root check as
    // every other path the app gives the OS.
    const abs = ensureFileInsideRoot(core, id);
    return ai.analyzeFile({ workspaceId, id, core }, abs);
  });
  handle("ai_vocabulary_add", ({ entries }) => ai.addVocabulary(entries));
}
