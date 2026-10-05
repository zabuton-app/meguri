// The tag screen's cloud view: the tags packed around a centre, each sized by
// how many files carry it. Clicking one filters the library by it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Cloud } from "lucide-react";
import { MAX_TAG_LIST } from "@shared/tags";
import type { TagSummary } from "@/ipc/types";
import { tagHumanLabel } from "@/lib/tagLabel";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import {
  CLOUD_MAX_TAGS,
  cloudFontSize,
  cloudLabel,
  cloudWeight,
  layoutCloud,
  pickCloudTags,
} from "./cloudLayout";

/** Padding of the scroll area (p-4), taken off its size when fitting the cloud. */
const VIEWPORT_PADDING = 32;
const FONT_WEIGHT = 500;
const LINE_HEIGHT = 1.2;
/**
 * How far the cloud is shrunk to fit before it scrolls instead. Kept high
 * enough that the smallest words stay legible.
 */
const MIN_SCALE = 0.8;
/** How far a sparse cloud is blown up to fill the modal. */
const MAX_SCALE = 1.6;

/** Colour by weight, so the size ranking also reads at a glance. */
function weightColorClass(weight: number): string {
  if (weight >= 0.75) return "text-primary";
  if (weight >= 0.5) return "text-info";
  if (weight >= 0.25) return "text-fg";
  return "text-muted";
}

type MeasureText = (text: string, fontSize: number) => number;

/**
 * Text width in the cloud's font. Measured on a canvas so the layout needs no
 * render-then-measure pass; where there is no 2D context (jsdom), a per-glyph
 * estimate keeps the words apart well enough.
 */
function createMeasurer(fontFamily: string): MeasureText {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return (text, fontSize) => {
    if (ctx) {
      ctx.font = `${FONT_WEIGHT} ${fontSize}px ${fontFamily}`;
      return ctx.measureText(text).width;
    }
    let width = 0;
    // CJK and other wide glyphs take a full em; Latin text about 0.6.
    for (const ch of text)
      width += (ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.6) * fontSize;
    return width;
  };
}

export function TagCloud({
  tags,
  includeAuto,
  truncated,
  onFilter,
}: {
  /** The catalog, already narrowed by the screen's filter box. */
  tags: TagSummary[];
  /** Draw pipeline-owned tags too. */
  includeAuto: boolean;
  /** The catalog itself was cut short, so a well-used tag may be missing. */
  truncated: boolean;
  onFilter: (tag: TagSummary) => void;
}) {
  const { t } = useI18n();
  const { tags: shown, limited } = useMemo(
    () => pickCloudTags(tags, includeAuto),
    [tags, includeAuto],
  );

  // Size of the area the cloud may fill, and the font it is drawn in.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{
    width: number;
    height: number;
    fontFamily: string;
  } | null>(null);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const read = () => {
      const next = {
        width: Math.max(1, el.clientWidth - VIEWPORT_PADDING),
        height: Math.max(1, el.clientHeight - VIEWPORT_PADDING),
        fontFamily: getComputedStyle(el).fontFamily || "sans-serif",
      };
      setViewport((prev) =>
        prev &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.fontFamily === next.fontFamily
          ? prev
          : next,
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A web font that arrives after the labels were measured (the bundled emoji
  // faces load on first use) changes their width; measure again when one does.
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    // Absent in jsdom.
    const fonts = document.fonts as FontFaceSet | undefined;
    if (!fonts) return;
    const bump = () => setFontsLoaded((n) => n + 1);
    fonts.addEventListener("loadingdone", bump);
    return () => fonts.removeEventListener("loadingdone", bump);
  }, []);

  const fontFamily = viewport?.fontFamily;
  // Quantised: the packing is re-run only when the area changes shape
  // noticeably, not on every pixel of a window resize.
  const aspect = viewport
    ? Math.round((viewport.width / viewport.height) * 4) / 4
    : null;

  const cloud = useMemo(() => {
    if (!fontFamily || aspect === null || shown.length === 0) return null;
    const measure = createMeasurer(fontFamily);
    // `shown` is sorted most used first.
    const max = shown[0].fileCount;
    const min = shown[shown.length - 1].fileCount;
    const words = shown.map((tag) => {
      const weight = cloudWeight(tag.fileCount, min, max);
      const fontSize = cloudFontSize(weight);
      const label = cloudLabel(tag.qualified);
      return {
        tag,
        label,
        weight,
        fontSize,
        width: Math.ceil(measure(label, fontSize)),
        height: Math.ceil(fontSize * LINE_HEIGHT),
      };
    });
    return { words, ...layoutCloud(words, aspect) };
    // fontsLoaded is not read: it only invalidates the measurements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, fontFamily, aspect, fontsLoaded]);

  const scale =
    cloud && viewport
      ? Math.min(
          MAX_SCALE,
          Math.max(
            MIN_SCALE,
            Math.min(
              viewport.width / cloud.width,
              viewport.height / cloud.height,
            ),
          ),
        )
      : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(truncated || limited) && (
        <p className="px-4 pt-3 text-xs text-muted">
          {truncated && t("tags.truncated", { max: MAX_TAG_LIST })}
          {truncated && limited && " "}
          {limited && t("tags.cloudLimited", { max: CLOUD_MAX_TAGS })}
        </p>
      )}
      <div ref={viewportRef} className="flex min-h-0 flex-1 overflow-auto p-4">
        {shown.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-2 text-center text-muted">
            <Cloud className="size-10 opacity-50" />
            {/* Something matched, but only tags the toggle is hiding. */}
            <p>
              {tags.some((tag) => tag.fileCount > 0)
                ? t("tags.cloudOnlyAuto")
                : t("tags.noMatch")}
            </p>
          </div>
        ) : (
          cloud && (
            // m-auto rather than centring on the container: a cloud larger
            // than the area must stay scrollable to its top-left corner.
            <ul
              className="relative m-auto shrink-0"
              style={{
                width: cloud.width * scale,
                height: cloud.height * scale,
              }}
            >
              {cloud.words.map((word, i) => {
                const { tag } = word;
                const count = t("tags.fileCount", { count: tag.fileCount });
                const name = tag.namespace
                  ? tagHumanLabel(t, tag.namespace, tag.name)
                  : tag.qualified;
                return (
                  <li
                    key={tag.qualified}
                    className="absolute"
                    style={{
                      left: cloud.positions[i].x * scale,
                      top: cloud.positions[i].y * scale,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onFilter(tag)}
                      title={`${name} — ${count}`}
                      aria-label={`${tag.qualified} (${count})`}
                      className={cn(
                        "block whitespace-nowrap rounded transition hover:text-bright-fg hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                        weightColorClass(word.weight),
                      )}
                      style={{
                        fontSize: word.fontSize * scale,
                        fontWeight: FONT_WEIGHT,
                        lineHeight: LINE_HEIGHT,
                      }}
                    >
                      {word.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
