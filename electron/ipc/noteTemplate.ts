// The template a new note starts from (#345): one for the library, kept with
// the other settings.
import { loadConfig, updateConfig } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";
import { normalizeNote } from "../../shared/note.js";

export function registerNoteTemplateHandlers(): void {
  handle("note_template_get", () => loadConfig().noteTemplate);
  handle("note_template_set", ({ template }) => {
    const noteTemplate = normalizeNote(template) ?? "";
    updateConfig((c) => ({ ...c, noteTemplate }));
    return noteTemplate;
  });
}
