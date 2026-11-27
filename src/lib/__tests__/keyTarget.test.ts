import { afterEach, describe, expect, it } from "vitest";
import { isLayerOnTop, isTyping } from "@/lib/keyTarget";

function add(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

afterEach(() => document.body.replaceChildren());

describe("isTyping", () => {
  it("is true while a text field has focus", () => {
    const host = add(
      "<input /><textarea></textarea><select></select><button>b</button>",
    );
    host.querySelector("input")!.focus();
    expect(isTyping()).toBe(true);
    host.querySelector("textarea")!.focus();
    expect(isTyping()).toBe(true);
    host.querySelector("select")!.focus();
    expect(isTyping()).toBe(true);
    host.querySelector("button")!.focus();
    expect(isTyping()).toBe(false);
  });
});

describe("isLayerOnTop", () => {
  it("is false when the view's own dialog is the only layer", () => {
    const host = add('<div role="dialog"><p id="view"></p></div>');
    expect(isLayerOnTop(host.querySelector("#view"))).toBe(false);
  });

  it("is true when another dialog or menu is open beside the view's", () => {
    const host = add('<div role="dialog"><p id="view"></p></div>');
    const view = host.querySelector("#view");
    const confirm = add('<div role="alertdialog"></div>');
    expect(isLayerOnTop(view)).toBe(true);
    confirm.remove();
    add('<div role="menu"></div>');
    expect(isLayerOnTop(view)).toBe(true);
  });

  it("is true for a layer opened inside the view", () => {
    const host = add(
      '<div role="dialog"><p id="view"></p><div role="menu"></div></div>',
    );
    expect(isLayerOnTop(host.querySelector("#view"))).toBe(true);
  });

  it("does not count a layer the view's own layer sits in", () => {
    const host = add(
      '<div role="dialog"><div role="dialog"><p id="view"></p></div></div>',
    );
    expect(isLayerOnTop(host.querySelector("#view"))).toBe(false);
  });

  it("ignores a popup that is playing its exit animation", () => {
    const host = add('<div role="dialog"><p id="view"></p></div>');
    add('<div role="menu" data-state="closed"></div>');
    expect(isLayerOnTop(host.querySelector("#view"))).toBe(false);
  });

  it("treats any layer as on top of a view that is not one", () => {
    const host = add('<p id="view"></p>');
    const view = host.querySelector("#view");
    expect(isLayerOnTop(view)).toBe(false);
    add('<div role="dialog"></div>');
    expect(isLayerOnTop(view)).toBe(true);
    expect(isLayerOnTop(null)).toBe(true);
  });
});
