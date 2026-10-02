// The graph's colours, read from the theme's semantic variables. WebGL cannot
// see CSS variables, so they are resolved to strings here and handed to sigma.
// Re-read whenever <html>'s theme attributes change: ThemeProvider sets them
// in its own effect, which runs after this component's, so a dependency on
// the theme alone would read the previous theme.
import { useEffect, useState } from "react";

export interface GraphColors {
  video: string;
  image: string;
  audio: string;
  tag: string;
  autoTag: string;
  edge: string;
  /** The focused node and its links. */
  highlight: string;
  label: string;
  /** The canvas background, which faded things are mixed into. */
  bg: string;
  font: string;
}

const FALLBACK: GraphColors = {
  video: "#83a598",
  image: "#d3869b",
  audio: "#8ec07c",
  tag: "#fabd2f",
  autoTag: "#bdae93",
  edge: "#665c54",
  highlight: "#d65d0e",
  label: "#d5c4a1",
  bg: "#282828",
  font: "system-ui, sans-serif",
};

export function readGraphColors(root: HTMLElement): GraphColors {
  const style = getComputedStyle(root);
  const v = (name: string, fallback: string) =>
    style.getPropertyValue(`--c-${name}`).trim() || fallback;
  return {
    video: v("primary", FALLBACK.video),
    image: v("secondary-accent", FALLBACK.image),
    audio: v("info", FALLBACK.audio),
    tag: v("accent2", FALLBACK.tag),
    autoTag: v("secondary-fg", FALLBACK.autoTag),
    edge: v("muted", FALLBACK.edge),
    highlight: v("special", FALLBACK.highlight),
    label: v("fg", FALLBACK.label),
    bg: v("bg", FALLBACK.bg),
    font: getComputedStyle(document.body).fontFamily || FALLBACK.font,
  };
}

export function useGraphColors(): GraphColors {
  const [colors, setColors] = useState<GraphColors>(() =>
    readGraphColors(document.documentElement),
  );
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setColors((prev) => {
        const next = readGraphColors(root);
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-skin", "class", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}
