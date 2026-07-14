// base16 scheme definitions and the base16 → semantic-token mapping.
//
// Follows PLAN "Standard base16 → semantic mapping":
//   base00=bg / base01=surface / base02=overlay/border / base03=muted
//   base04=secondary-fg / base05=fg / base06=bright-fg / base07=highlight
//   base08=red→error / base09=orange→warn / base0A=yellow→accent2 / base0B=green→success
//   base0C=cyan→info / base0D=blue→primary / base0E=magenta→secondary-accent
//   base0F=brown→special

export interface Base16Scheme {
  /** Unique data-theme value. */
  id: string;
  /** Display name. */
  name: string;
  /** Family (e.g. gruvbox). Identifier that bundles the light/dark pair. */
  family: string;
  /** Family display name. */
  familyName: string;
  /** "light" | "dark" (inherent to the base16 scheme itself). */
  appearance: "light" | "dark";
  /** The 16 colors base00..base0F. Hex with a leading #. */
  palette: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
}

/** Our own semantic tokens → corresponding base16 index. */
const SEMANTIC_MAP = {
  bg: 0x0,
  surface: 0x1,
  overlay: 0x2,
  border: 0x2,
  muted: 0x3,
  "secondary-fg": 0x4,
  fg: 0x5,
  "bright-fg": 0x6,
  highlight: 0x7,
  error: 0x8,
  warn: 0x9,
  accent2: 0xa,
  success: 0xb,
  info: 0xc,
  primary: 0xd,
  "secondary-accent": 0xe,
  special: 0xf,
} as const;

export type SemanticToken = keyof typeof SEMANTIC_MAP;

/**
 * Generate the set of "--c-<token>: <hex>;" CSS declarations from a scheme.
 * These are poured into the `[data-theme="<id>"]` block. `--c-*` are the runtime-swappable
 * "values", which Tailwind's `--color-*` reference via @theme inline.
 */
export function schemeToCssVars(scheme: Base16Scheme): string {
  const lines: string[] = [];
  for (const [token, idx] of Object.entries(SEMANTIC_MAP)) {
    lines.push(`  --c-${token}: ${scheme.palette[idx]};`);
  }
  return lines.join("\n");
}
