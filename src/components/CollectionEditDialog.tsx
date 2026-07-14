// Create/edit dialog for a user collection (name + emoji). Shared by the
// WorkspaceRail context menu and the Home header's "edit collection" button, so
// the same form drives both creation and editing.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderPlus } from "lucide-react";
import { api } from "@/ipc/client";
import type { UserCollection } from "@/ipc/types";
import { EmojiPicker } from "@/components/EmojiPicker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

export function CollectionEditDialog({
  open,
  onOpenChange,
  collection,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The collection to edit; null/undefined puts the dialog in create mode. */
  collection?: UserCollection | null;
  /** Called after a new collection is created (edit mode never fires this). */
  onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const isEdit = !!collection;
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Seed the fields whenever the dialog opens (edit: current values; create: empty).
  useEffect(() => {
    if (!open) return;
    // Initializing the edit-form state from props the moment the dialog opens is a legitimate pattern, so synchronous setState is allowed.
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(collection?.name ?? "");
    setEmoji(collection?.emoji ?? null);
    setPickerOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, collection]);

  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: ["workspaces_list"] });

  const createCollection = useMutation({
    mutationFn: ({ name, emoji }: { name: string; emoji?: string }) =>
      api.collectionCreate(name, emoji),
    onSuccess: () => {
      void invalidateList();
      onCreated?.();
    },
    onError: (error) => {
      toast.error(t("collection.createFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const renameCollection = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.collectionRename(id, name),
    onSuccess: invalidateList,
    onError: invalidateList,
  });
  const setCollectionEmoji = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string | null }) =>
      api.collectionSetEmoji(id, emoji),
    onSuccess: invalidateList,
    onError: invalidateList,
  });

  const setVisible = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setPickerOpen(false);
      // Radix can leave `pointer-events: none` on <body> when this dialog
      // unmounts while a context menu that opened it is still tearing down,
      // which freezes the whole window. Defensively clear it after close.
      setTimeout(() => {
        if (document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "";
        }
      }, 0);
    }
  };

  const onSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (collection) {
      if (collection.name !== trimmed) {
        renameCollection.mutate({ id: collection.id, name: trimmed });
      }
      const nextEmoji = emoji ?? null;
      if ((collection.emoji ?? null) !== nextEmoji) {
        setCollectionEmoji.mutate({ id: collection.id, emoji: nextEmoji });
      }
    } else {
      createCollection.mutate({ name: trimmed, emoji: emoji ?? undefined });
    }
    setVisible(false);
  };

  return (
    <Dialog open={open} onOpenChange={setVisible}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader className="p-5 pb-3">
            <DialogTitle>
              {isEdit ? t("collection.edit") : t("collection.create")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 px-5 pb-5">
            <Button
              type="button"
              variant="outline"
              className="size-10 shrink-0 p-0 text-xl leading-none"
              aria-label={t("emoji.choose")}
              title={t("emoji.choose")}
              onClick={() => setPickerOpen(true)}
            >
              {emoji ?? <FolderPlus className="size-5 text-muted" />}
            </Button>
            <EmojiPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onSelect={(next) => setEmoji(next)}
              canRemove={!!emoji}
            />
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("collection.namePrompt")}
            />
          </div>
          <DialogFooter className="border-t border-border p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setVisible(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {isEdit
                ? t("collection.editAction")
                : t("collection.createAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
