// The note's Markdown reads back as what the user wrote: typed text that looks
// like a block marker stays text, and text typed after a link is not linked.
import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
  NoteLink,
  NoteParagraph,
  escapeLineStarts,
} from "@/routes/MediaDetail/noteExtensions";

function editorWith(content: JSONContent | string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false, link: false }),
      NoteParagraph,
      NoteLink.configure({ autolink: true }),
      Markdown,
    ],
    content,
    ...(typeof content === "string" ? { contentType: "markdown" } : {}),
  });
}

function paragraphOf(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("a note's paragraph in Markdown", () => {
  it.each([
    "1. You may reuse this clip",
    "2) second",
    "- source: pexels",
    "+ plus",
    "-",
    "# not a heading",
    "###",
    "---",
    "===",
  ])("reads %j back as the same paragraph", (text) => {
    const md = editorWith(paragraphOf(text)).getMarkdown();
    const back = editorWith(md).getJSON();
    expect(back.content).toEqual(paragraphOf(text).content);
  });

  it("leaves text that starts no block as it is", () => {
    expect(escapeLineStarts("Source: https://example.com/1")).toBe(
      "Source: https://example.com/1",
    );
    expect(escapeLineStarts("-5 degrees")).toBe("-5 degrees");
    expect(escapeLineStarts("#hashtag")).toBe("#hashtag");
    expect(escapeLineStarts("2024.01 shoot")).toBe("2024.01 shoot");
  });

  it("keeps real lists and headings as they are", () => {
    const md = "# Title\n\n- one\n- two\n\n1. first";
    const back = editorWith(md).getJSON();
    expect(back.content?.map((n) => n.type)).toEqual([
      "heading",
      "bulletList",
      "orderedList",
    ]);
  });
});

describe("a link in a note", () => {
  it("does not take in text typed right after it", () => {
    const editor = editorWith("[clip](https://example.com/1)");
    editor.commands.focus("end");
    editor.commands.insertContent(" (CC0)");
    expect(editor.getMarkdown()).toBe("[clip](https://example.com/1) (CC0)");
  });
});
