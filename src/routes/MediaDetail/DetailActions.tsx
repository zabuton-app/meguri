import {
  ChevronDown,
  Contrast,
  Copy,
  ExternalLink,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  ImageDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import type { FileDetail } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { copyImageToClipboard } from "./utils";
import type { CollectionRef } from "./useDetailMutations";

interface DetailCollection extends CollectionRef {
  items: { workspaceId: string; fileId: number }[];
}

/**
 * Title row of the detail view: the file name and folder (the two strings
 * users copy out), the action buttons and the collection membership menu.
 */
export function DetailActions({
  detail,
  basename,
  dir,
  fileId,
  wsId,
  mediaSrc,
  collections,
  imageBgInverted,
  onToggleImageBg,
  onOpenExternal,
  onDeleteFromIndex,
  onAddToCollection,
  onRemoveFromCollection,
  t,
}: {
  detail: FileDetail;
  /** File name and folder, split off `detail.relPath` by the caller. */
  basename: string;
  dir: string;
  fileId: number;
  wsId: string;
  mediaSrc: string;
  collections: DetailCollection[];
  imageBgInverted: boolean;
  onToggleImageBg: () => void;
  onOpenExternal: () => void;
  onDeleteFromIndex: () => void;
  onAddToCollection: (c: CollectionRef) => void;
  onRemoveFromCollection: (c: CollectionRef) => void;
  t: TFunc;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {/* File name and folder are the two strings users copy out. */}
        <h1
          className="select-text truncate text-lg font-semibold text-bright-fg"
          title={detail.relPath}
        >
          {basename}
        </h1>
        {dir && (
          <p
            className="select-text truncate text-xs text-muted"
            title={detail.relPath}
          >
            {dir}
          </p>
        )}
      </div>
      <ButtonGroup className="shrink-0">
        {detail.kind === "image" && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="border-muted/35 bg-surface px-2"
              onClick={onToggleImageBg}
              aria-label={t("media.invertImageBackground")}
              aria-pressed={imageBgInverted}
              title={t("media.invertImageBackground")}
            >
              <Contrast />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-muted/35 bg-surface px-2"
              disabled={!mediaSrc}
              onClick={() => {
                if (!mediaSrc) return;
                void copyImageToClipboard(mediaSrc)
                  .then(() => toast.success(t("media.imageCopied")))
                  .catch((e: unknown) => {
                    console.error("copy image failed:", e);
                    toast.error(t("media.imageCopyFailed"));
                  });
              }}
              aria-label={t("media.copyImage")}
              title={t("media.copyImage")}
            >
              <ImageDown />
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="border-muted/35 bg-surface"
          onClick={onOpenExternal}
        >
          <ExternalLink />
          {t("media.openExternal")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-muted/35 bg-surface px-2"
              aria-label={t("media.moreActions")}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-44 border border-muted/35 bg-surface p-0"
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="rounded-none px-3 py-2 text-xs"
                onSelect={() => void api.openFolder(fileId, wsId)}
              >
                <FolderOpen />
                {t("media.openFolder")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
              <DropdownMenuItem
                className="rounded-none px-3 py-2 text-xs"
                onSelect={() => void api.copyFilePath(fileId, wsId)}
              >
                <Copy />
                {t("media.copyFilePath")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
              <DropdownMenuItem
                className="rounded-none px-3 py-2 text-xs text-error data-[highlighted]:text-error"
                onSelect={onDeleteFromIndex}
              >
                <Trash2 />
                {t("media.deleteFromIndex")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      {/* Collection actions: kept as a standalone dropdown, independent of the
          open-external/more-actions button group. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-muted/35 bg-surface px-2"
            aria-label={t("collection.addToMenu")}
            title={t("collection.addToMenu")}
          >
            <FolderPlus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-44 border border-muted/35 bg-surface p-0"
        >
          <DropdownMenuGroup>
            {/* Kept as a guard for a not-yet-loaded/failed workspaces_list
                query. In practice the list is never empty at rest: the
                built-in Watch Later collection is always seeded, and it
                shows up in this menu like any other collection. */}
            {collections.length === 0 ? (
              <DropdownMenuItem
                disabled
                className="rounded-none px-3 py-2 text-xs"
              >
                <FolderPlus />
                {t("collection.empty")}
              </DropdownMenuItem>
            ) : (
              collections.map((collection) => {
                const included = collection.items.some(
                  (item) => item.workspaceId === wsId && item.fileId === fileId,
                );
                return (
                  <DropdownMenuItem
                    key={collection.id}
                    className="rounded-none px-3 py-2 text-xs"
                    onSelect={() =>
                      included
                        ? onRemoveFromCollection(collection)
                        : onAddToCollection(collection)
                    }
                  >
                    {included ? <FolderMinus /> : <FolderPlus />}
                    {included
                      ? t("collection.removeFrom", { name: collection.name })
                      : t("collection.addTo", { name: collection.name })}
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
