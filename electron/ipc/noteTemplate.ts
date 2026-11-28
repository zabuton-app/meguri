// The template a new note starts from (#345): one for the library, kept with
// the other settings.
import { loadConfig, saveNoteTemplate } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";

export function registerNoteTemplateHandlers(): void {
  handle("note_template_get", () => loadConfig().noteTemplate);
  // Throws when the write did not land, so Settings shows the save as failed.
  handle("note_template_set", ({ template }) => saveNoteTemplate(template));
}
