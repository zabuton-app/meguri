// What the tag screen's rename, merge and delete do to the auto-tagging
// conditions that name the tags (keyword entries and folder rules), so the
// next scan does not put the old name back. Regex rules name their tags
// through a template and are left alone.
import type { AutoTagConfig } from "./autoTag.js";
import { tagIdentityKey } from "./tags.js";

/**
 * `tags` with every one of `keys` replaced by `to` (once, where the first of
 * them stood), or dropped when `to` is null. The same array when none is there.
 */
function retagList(
  tags: string[],
  keys: ReadonlySet<string>,
  to: string | null,
): string[] {
  if (!tags.some((tag) => keys.has(tagIdentityKey(tag)))) return tags;
  const toKey = to === null ? null : tagIdentityKey(to);
  const out: string[] = [];
  let placed = false;
  for (const tag of tags) {
    const key = tagIdentityKey(tag);
    if (keys.has(key) || key === toKey) {
      if (to !== null && !placed) out.push(to);
      placed = true;
      continue;
    }
    out.push(tag);
  }
  return out;
}

/**
 * The conditions after the tags named `from` became `to` (a rename or a
 * merge), or went (`to` null, a delete). Names compare by tagIdentityKey, as
 * the tags themselves do. A condition left with no tags stays, its terms or
 * folder kept for the user to give it new ones. The same config object when no
 * condition names any of `from`.
 */
export function retagConditions(
  config: AutoTagConfig,
  from: readonly string[],
  to: string | null,
): AutoTagConfig {
  const keys = new Set(from.map(tagIdentityKey));
  let changed = false;
  const retag = <T extends { tags: string[] }>(item: T): T => {
    const tags = retagList(item.tags, keys, to);
    if (tags === item.tags) return item;
    changed = true;
    return { ...item, tags };
  };
  const keywords = config.keywords.map(retag);
  const folders = config.folders.map(retag);
  return changed ? { ...config, keywords, folders } : config;
}
