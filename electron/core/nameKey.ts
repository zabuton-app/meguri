// The key the name sort orders files by (#292): the order a file manager uses,
// case folded and with digit runs compared as numbers, so `Ep2` comes before
// `Ep10`. Stored per row (files.name_key) because SQLite's collations cannot
// compare digits numerically and the list pages with a keyset on the key.

/** Bump when naturalNameKey changes: every stored key is computed again. */
export const NAME_KEY_VERSION = 1;
/** Where the version the stored keys were computed with is kept (settings). */
export const NAME_KEY_VERSION_SETTING = "name_key_version";

/**
 * The sort key of a relative path, compared as a plain string (SQLite's BINARY
 * collation, `<` in JS). Each digit run, leading zeros dropped, is written as
 * its length, prefixed by how many digits that length has, and then the
 * digits: a shorter number sorts first at any length, and numbers of one
 * length compare digit by digit. `Ep02` and `Ep2` get the same key, and the id
 * breaks the tie.
 */
export function naturalNameKey(relPath: string): string {
  return relPath.toLowerCase().replace(/\d+/g, (run) => {
    const digits = run.replace(/^0+(?=\d)/, "");
    const length = String(digits.length);
    return `${length.length}${length}${digits}`;
  });
}
