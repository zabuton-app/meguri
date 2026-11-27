// Messages between useAlignment.ts and align.worker.ts.
import type { AlignResult } from "./alignImages";

export interface AlignRequest {
  /** Media server URLs of A and B. */
  a: string;
  b: string;
}

export type AlignResponse =
  /** How much of the search is done; sent once the images are decoded. */
  | { type: "progress"; fraction: number }
  | ({ type: "result" } & AlignResult)
  | { type: "error"; message: string };
