// An empty bullet survives being written to Markdown and read back (#345): a
// template's "Used in" list starts with one, and it must not come back as the
// text "- ".
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { noteExtensions } from "@/routes/MediaDetail/noteEditor";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** The document after its Markdown is read back, beside the one written. */
function roundTrip(html: string) {
  const editor = new Editor({ extensions: noteExtensions("") });
  editors.push(editor);
  // Through setContent, as the read below goes, so both get the trailing
  // paragraph Tiptap adds after a list or a heading.
  editor.commands.setContent(html);
  const written = editor.getJSON();
  editor.commands.setContent(editor.getMarkdown(), { contentType: "markdown" });
  return { written, read: editor.getJSON() };
}

describe("an empty bullet in a note", () => {
  it.each([
    ["on its own", "<ul><li><p></p></li></ul>"],
    ["after a paragraph", "<p>Used in</p><ul><li><p></p></li></ul>"],
    ["after a heading", "<h2>Used in</h2><ul><li><p></p></li></ul>"],
    ["after a filled one", "<ul><li><p>a</p></li><li><p></p></li></ul>"],
  ])("reads back as an empty bullet %s", (_case, html) => {
    const { written, read } = roundTrip(html);
    expect(read).toEqual(written);
  });

  it("keeps a filled bullet as it is", () => {
    const { written, read } = roundTrip(
      "<ul><li><p>- not a bullet</p></li></ul>",
    );
    expect(read).toEqual(written);
  });
});
