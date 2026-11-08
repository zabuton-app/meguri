import { AUTO_META_VALUES } from "@shared/tags";

const VALUES = new Set(Object.values(AUTO_META_VALUES).flat());

/**
 * Whether a tag name repeats something the metadata classifier already derives
 * (`4k`, `short`, `vertical`…). Worth a warning: the file would carry it twice.
 */
export function isAutoMetaValue(key: string): boolean {
  return VALUES.has(key.toLowerCase());
}
