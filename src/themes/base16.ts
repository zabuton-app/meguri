// base16 scheme shape. The palettes themselves live in schemes.ts and follow their upstream
// definitions verbatim; derive.ts maps the slots onto semantic tokens and enforces the
// contrast floors the raw palettes do not guarantee.
//
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
