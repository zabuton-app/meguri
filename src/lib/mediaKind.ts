// Kind-to-presentation mapping, shared by every site that labels or icons a media kind.
//
// `FileRow.kind` is typed as a plain string end to end (see shared/ipc/schema.ts), so
// TypeScript cannot flag the `kind === "video" ? … : …` shape that silently treats
// "not video" as "image". Consolidating those sites here means adding a kind touches
// one file instead of nine, and an unknown kind degrades to a neutral fallback rather
// than being mislabelled.
import { Film, ImageIcon, Music, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/locales/ja";

export function kindLabelKey(kind: string): TranslationKey {
  switch (kind) {
    case "video":
      return "kind.video";
    case "audio":
      return "kind.audio";
    default:
      return "kind.image";
  }
}

export function kindIcon(kind: string): LucideIcon {
  switch (kind) {
    case "video":
      return Film;
    case "audio":
      return Music;
    default:
      return ImageIcon;
  }
}
