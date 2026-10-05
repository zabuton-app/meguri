// The detail view's "from the file name" row: the name's parts as tags to add.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NameTags } from "@/routes/MediaDetail/NameTags";
import type { FileDetail } from "@/ipc/types";

const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${String(vars.tag)}` : key;

const tag = (name: string, namespace = ""): FileDetail["tags"][number] => ({
  id: 1,
  name,
  namespace,
  source: "manual",
  score: null,
});

describe("NameTags", () => {
  it("adds the part clicked as a tag: a word, a code's prefix, a bracket entry", () => {
    const onAdd = vi.fn();
    render(
      <NameTags
        basename="ABCD-123 [Trip, Family] harbor.mp4"
        tags={[]}
        onAdd={onAdd}
        t={t}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "media.nameTags.add:ABCD" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "media.nameTags.add:Family" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "media.nameTags.add:harbor" }),
    );
    expect(onAdd.mock.calls).toEqual([["ABCD"], ["Family"], ["harbor"]]);
    // The extension is not something to tag by.
    expect(screen.queryByRole("button", { name: /mp4/ })).toBeNull();
  });

  it("shows a part the file is already tagged with as done, ASCII case aside", () => {
    const onAdd = vi.fn();
    render(
      <NameTags
        basename="[Trip] harbor.mp4"
        // `harbor` here is a derived tag of another namespace, not the user's.
        tags={[tag("trip"), tag("harbor", "ai")]}
        onAdd={onAdd}
        t={t}
      />,
    );
    const done = screen.getByRole("button", {
      name: "media.nameTags.tagged:Trip",
    });
    expect(done).toHaveProperty("disabled", true);
    fireEvent.click(done);
    expect(onAdd).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "media.nameTags.add:harbor" }),
    ).toHaveProperty("disabled", false);
  });

  it("tells two tags apart where the tag table does", () => {
    // Above ASCII a difference of case is a different tag, and can be added.
    render(
      <NameTags basename="Été.mp4" tags={[tag("été")]} onAdd={vi.fn()} t={t} />,
    );
    expect(
      screen.getByRole("button", { name: "media.nameTags.add:Été" }),
    ).toHaveProperty("disabled", false);
  });

  it("is not there for a name with nothing to tag by", () => {
    const { container } = render(
      <NameTags basename="_.mp4" tags={[]} onAdd={vi.fn()} t={t} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
