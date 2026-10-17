// The pictures the flat graph draws file nodes with: each file's thumbnail,
// cropped to a square and scaled to one cell of a canvas that every
// NodeThumbProgram (sigma's node layer and its hover layer, each a WebGL
// context of its own) copies into a texture.
//
// Cells are keyed by file, not by URL: a regenerated thumbnail gets a new
// cache buster, and is drawn over its file's old cell rather than taking a
// new one (the old picture stays on show until the new one is in, and if
// the new one fails). A file new to the atlas takes the cell of a file not
// wanted any more before an empty one, so the cells in use, and the canvas
// that grows to hold them (a row at a time, doubling its height), stay
// about as many as the files on show rather than creeping up to the most
// as the filters change.

/** A cell's side, in pixels: enough for the largest node on screen. */
export const CELL = 128;
/** Cells per row of the atlas: 4096 px, a texture side every desktop GPU
 *  takes. */
export const COLUMNS = 32;
/** The most cells: past the largest thumbnail limit (1000; a test holds the
 *  two together). A square atlas of 4096 px at the most. */
export const CELLS = 1024;
/** The atlas's width, and its smallest height. */
export const ATLAS_WIDTH = COLUMNS * CELL;
const MIN_HEIGHT = 4 * CELL;

export type CellStatus = "loading" | "ready" | "error";

interface Cell {
  key: string;
  version: number;
  status: CellStatus;
  /** The cell holds a picture of the file (an older version, perhaps). */
  drawn: boolean;
  /** The request pass that last wanted it (for giving up the oldest). */
  used: number;
}

/** Which file has which cell, and where its picture stands. No DOM. */
export class CellTable {
  private readonly cells: (Cell | undefined)[];
  private readonly byKey = new Map<string, number>();

  constructor(private readonly capacity = CELLS) {
    this.cells = new Array<Cell | undefined>(capacity);
  }

  /** The cell the file has, if any. */
  lookup(
    key: string,
  ): { index: number; status: CellStatus; drawn: boolean } | undefined {
    const index = this.byKey.get(key);
    if (index == null) return undefined;
    const cell = this.cells[index];
    return cell && { index, status: cell.status, drawn: cell.drawn };
  }

  /** Gives the file a cell for `version` of its picture. `load` says the
   *  picture has to be (re)loaded: it is new to the table, or newer than the
   *  one the cell holds. A failed picture is not tried again until its
   *  version changes. */
  claim(
    key: string,
    version: number,
    pass: number,
  ): { index: number; load: boolean } {
    const held = this.byKey.get(key);
    if (held != null) {
      const cell = this.cells[held]!;
      cell.used = pass;
      if (version <= cell.version) return { index: held, load: false };
      cell.version = version;
      cell.status = "loading";
      return { index: held, load: true };
    }
    const index = this.freeIndex(pass);
    const old = this.cells[index];
    if (old) this.byKey.delete(old.key);
    this.cells[index] = {
      key,
      version,
      status: "loading",
      drawn: false,
      used: pass,
    };
    this.byKey.set(key, index);
    return { index, load: true };
  }

  /** A load finished. False when the cell went to another file, or to a
   *  newer version, while it was under way: the result is stale. */
  settle(
    index: number,
    key: string,
    version: number,
    status: "ready" | "error",
  ): boolean {
    const cell = this.cells[index];
    if (!cell || cell.key !== key || cell.version !== version) return false;
    cell.status = status;
    if (status === "ready") cell.drawn = true;
    return true;
  }

  /** One past the highest cell in use. */
  get extent(): number {
    for (let i = this.capacity - 1; i >= 0; i--)
      if (this.cells[i]) return i + 1;
    return 0;
  }

  /** The cell used longest ago among those `pass` does not want, else the
   *  lowest empty cell, else the one used longest ago. */
  private freeIndex(pass: number): number {
    let empty = -1;
    let oldest = -1;
    for (let i = 0; i < this.capacity; i++) {
      const cell = this.cells[i];
      if (!cell) {
        if (empty < 0) empty = i;
      } else if (oldest < 0 || cell.used < this.cells[oldest]!.used) {
        oldest = i;
      }
    }
    if (oldest >= 0 && this.cells[oldest]!.used < pass) return oldest;
    return empty >= 0 ? empty : Math.max(0, oldest);
  }
}

/** The centred square of a picture (what `object-fit: cover` keeps of it
 *  in a square), or null for a picture without a size. */
export function coverCrop(
  width: number,
  height: number,
): { sx: number; sy: number; size: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const size = Math.min(width, height);
  return { sx: (width - size) / 2, sy: (height - size) / 2, size };
}

/** The atlas height that holds `cells` cells: whole rows, doubled from the
 *  smallest so a growing graph reallocates its textures only a few times. */
export function atlasHeight(cells: number): number {
  const rows = Math.max(1, Math.ceil(cells / COLUMNS));
  let height = MIN_HEIGHT;
  while (height < rows * CELL) height *= 2;
  return height;
}

/** Where cell `index` sits in the atlas, in pixels. */
export function cellOrigin(index: number): { x: number; y: number } {
  return { x: (index % COLUMNS) * CELL, y: Math.floor(index / COLUMNS) * CELL };
}

export interface ThumbRequest {
  key: string;
  url: string;
  version: number;
}

export class ThumbAtlas {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D | null;
  private readonly table = new CellTable();
  /** Per cell, the write that last changed it (0: never written). A
   *  program uploads each cell whose number is past the one it has. */
  readonly written = new Uint32Array(CELLS);
  private writes = 0;
  private pass = 0;
  private readonly loading = new Set<HTMLImageElement>();
  private frame = 0;

  /** `onChange` runs (at most once a frame) when pictures came in. */
  constructor(private readonly onChange: () => void) {
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = MIN_HEIGHT;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  /** The cell to draw the file with, or -1 while it has no picture yet. */
  readyCell(key: string): number {
    const cell = this.table.lookup(key);
    return cell?.drawn ? cell.index : -1;
  }

  /** The files the view would draw as pictures now: each gets a cell, and
   *  a load where its picture is missing or out of date. */
  request(wanted: Iterable<ThumbRequest>): void {
    if (!this.ctx) return;
    const pass = ++this.pass;
    // Files that hold a cell first: claimed for this pass, none of their
    // cells goes to a file new to the atlas.
    const held: ThumbRequest[] = [];
    const fresh: ThumbRequest[] = [];
    for (const r of wanted) (this.table.lookup(r.key) ? held : fresh).push(r);
    for (const { key, url, version } of [...held, ...fresh]) {
      const { index, load } = this.table.claim(key, version, pass);
      if (load) this.load(index, key, url, version);
    }
    this.grow();
  }

  /** Pixels of one cell, for a texture upload. */
  cellPixels(index: number): ImageData | null {
    const { x, y } = cellOrigin(index);
    return this.ctx?.getImageData(x, y, CELL, CELL) ?? null;
  }

  dispose(): void {
    for (const img of this.loading) {
      img.onload = null;
      img.onerror = null;
      img.src = "";
    }
    this.loading.clear();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.ctx = null;
  }

  private load(index: number, key: string, url: string, version: number) {
    const img = new Image();
    // The media server allows any origin; without this the picture would
    // taint the canvas and could not go into a texture.
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    this.loading.add(img);
    const settled = () => {
      this.loading.delete(img);
      img.onload = null;
      img.onerror = null;
    };
    const finish = (bitmap: ImageBitmap | null) => {
      if (
        !this.ctx ||
        !this.table.settle(index, key, version, bitmap ? "ready" : "error")
      ) {
        bitmap?.close();
        return;
      }
      if (bitmap) {
        const { x, y } = cellOrigin(index);
        this.ctx.clearRect(x, y, CELL, CELL);
        this.ctx.drawImage(bitmap, x, y);
        bitmap.close();
        this.written[index] = ++this.writes;
      }
      this.changed();
    };
    img.onload = () => {
      settled();
      const crop = coverCrop(img.naturalWidth, img.naturalHeight);
      if (!crop) return finish(null);
      // Decoded, cropped and scaled off the main thread: drawing the image
      // itself would decode it there, a few milliseconds a picture.
      createImageBitmap(img, crop.sx, crop.sy, crop.size, crop.size, {
        resizeWidth: CELL,
        resizeHeight: CELL,
        resizeQuality: "high",
      }).then(finish, () => finish(null));
    };
    img.onerror = () => {
      settled();
      finish(null);
    };
    img.src = url;
  }

  /** Makes the canvas tall enough for every cell in use, keeping what it
   *  holds. */
  private grow(): void {
    const height = atlasHeight(this.table.extent);
    if (!this.ctx || height <= this.canvas.height) return;
    const old = document.createElement("canvas");
    old.width = this.canvas.width;
    old.height = this.canvas.height;
    old.getContext("2d")?.drawImage(this.canvas, 0, 0);
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.ctx?.drawImage(old, 0, 0);
  }

  private changed(): void {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.onChange();
    });
  }
}
