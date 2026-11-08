import { fileNameParts } from "@/lib/relPath";

/** Show the stem, but keep the full filename available to screen readers. */
export function MediaFileName({ relPath }: { relPath: string }) {
  const { name, extension } = fileNameParts(relPath);
  return (
    <>
      {name}
      <span className="sr-only">{extension}</span>
    </>
  );
}

/** Keep the format close to its title without spending the title's text on a suffix. */
export function FileExtensionBadge({ relPath }: { relPath: string }) {
  const { extension } = fileNameParts(relPath);
  if (!extension) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="file-extension"
      className="shrink-0 select-none rounded border border-border-strong bg-surface px-1.5 py-0.5 text-xs font-semibold leading-none text-bright-fg"
    >
      {extension.slice(1).toUpperCase()}
    </span>
  );
}
