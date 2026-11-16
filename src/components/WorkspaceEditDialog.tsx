// Edit dialog for a workspace (scan root). Mirrors CollectionEditDialog's flow,
// but a workspace's path is its stable identity (hash of the path drives its DB
// and thumbnails), so only the emoji is editable here — the path is shown in a
// disabled field to make clear it can't be changed. It also lists the folders
// the workspace's scans leave out (#282), to take them off the list.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen } from "lucide-react";
import { api } from "@/ipc/client";
import type { WorkspaceInfo } from "@/ipc/types";
import { EmojiPicker } from "@/components/EmojiPicker";
import {
  ExcludedFoldersSection,
  type StagedFolder,
} from "@/components/ExcludedFoldersSection";
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
import { invalidateHiddenFiles } from "@/lib/queryCache";

export function WorkspaceEditDialog({
  open,
  onOpenChange,
  workspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The workspace to edit; null closes the dialog. */
  workspace: WorkspaceInfo | null;
}) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [emoji, setEmoji] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Excluded folders taken off the list, applied on save.
  const [included, setIncluded] = useState<ReadonlySet<string>>(new Set());
  // Folders picked to exclude, added on save.
  const [added, setAdded] = useState<StagedFolder[]>([]);
  const wsId = workspace?.id ?? "";
  const excluded = useQuery({
    queryKey: ["scan_exclusion_folders", wsId],
    queryFn: () => api.scanExclusionsFolders(wsId),
    enabled: open && wsId !== "",
  });

  // Seed the emoji whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    // Initializing the edit-form state from props the moment the dialog opens is a legitimate pattern, so synchronous setState is allowed.
    /* eslint-disable react-hooks/set-state-in-effect */
    setEmoji(workspace?.emoji ?? null);
    setPickerOpen(false);
    setIncluded(new Set());
    setAdded([]);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, workspace]);

  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: ["workspaces_list"] });

  const setWorkspaceEmoji = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string | null }) =>
      api.workspaceSetEmoji(id, emoji),
    onSettled: invalidateList,
  });

  // One save for both, so the staged changes all go or none do.
  const saveFolders = useMutation({
    mutationFn: ({
      id,
      include,
      add,
    }: {
      id: string;
      include: string[];
      add: string[];
    }) => api.scanExclusionsUpdateFolders(id, { add, remove: include }),
    meta: { reportsOwnError: true },
    onSuccess: (next, { id, add }) => {
      qc.setQueryData(["scan_exclusion_folders", id], next);
      // What the added folders hold is hidden now.
      if (add.length > 0) invalidateHiddenFiles(qc);
    },
    onError: () => {
      toast.error(t("workspace.excludedFoldersSaveError"));
      void qc.invalidateQueries({ queryKey: ["scan_exclusion_folders"] });
    },
  });

  const setVisible = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setPickerOpen(false);
      // Radix can leave `pointer-events: none` on <body> when this dialog
      // unmounts while a trigger that opened it is still tearing down, which
      // freezes the whole window. Defensively clear it after close.
      setTimeout(() => {
        if (document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "";
        }
      }, 0);
    }
  };

  const onSubmit = () => {
    if (workspace) {
      const nextEmoji = emoji ?? null;
      if ((workspace.emoji ?? null) !== nextEmoji) {
        setWorkspaceEmoji.mutate({ id: workspace.id, emoji: nextEmoji });
      }
      if (included.size > 0 || added.length > 0) {
        saveFolders.mutate({
          id: workspace.id,
          include: [...included],
          add: added.map((f) => f.path),
        });
      }
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
            <DialogTitle>{t("workspace.edit")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 px-5 pb-2">
            <Button
              type="button"
              variant="outline"
              className="size-10 shrink-0 p-0 text-xl leading-none"
              aria-label={t("emoji.choose")}
              title={t("emoji.choose")}
              onClick={() => setPickerOpen(true)}
            >
              {emoji ?? <FolderOpen className="size-5 text-muted" />}
            </Button>
            <EmojiPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onSelect={(next) => setEmoji(next)}
              canRemove={!!emoji}
            />
            <Input
              value={workspace?.path ?? ""}
              disabled
              title={workspace?.path ?? undefined}
            />
          </div>
          <p className="px-5 pb-5 text-xs text-muted">
            {t("workspace.pathReadonly")}
          </p>
          {workspace && (
            <ExcludedFoldersSection
              workspaceId={workspace.id}
              root={workspace.path}
              excluded={excluded}
              included={included}
              onIncludedChange={setIncluded}
              added={added}
              onAddedChange={setAdded}
            />
          )}
          <DialogFooter className="border-t border-border p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setVisible(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("workspace.editAction")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
