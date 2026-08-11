// Rename a user-owned tag. A rename into a name that is already taken is a
// merge in disguise, so the collision is detected here (against the catalog the
// screen already loaded) and confirmed before it is carried out.
import { useEffect, useState } from "react";
import { reservedTagPrefix } from "@shared/tags";
import type { TagSummary } from "@/ipc/types";
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

export function TagRenameDialog({
  open,
  onOpenChange,
  tag,
  existingNames,
  onRename,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tag being renamed; null keeps the dialog inert. */
  tag: TagSummary | null;
  /** Editable tag names already in the catalog, for collision detection. */
  existingNames: ReadonlySet<string>;
  onRename: (tag: TagSummary, newName: string) => void;
  /** Called instead of onRename when the target name is already taken. */
  onMerge: (tag: TagSummary, targetName: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    // Seeding the form from props the moment the dialog opens is the same
    // pattern CollectionEditDialog uses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(tag?.name ?? "");
  }, [open, tag]);

  const trimmed = name.trim();
  const reserved = reservedTagPrefix(trimmed);
  const collides = trimmed !== tag?.name && existingNames.has(trimmed);
  const canSubmit = !!tag && !!trimmed && reserved === null;

  const onSubmit = () => {
    if (!tag || !canSubmit) return;
    onOpenChange(false);
    if (trimmed === tag.name) return;
    if (collides) onMerge(tag, trimmed);
    else onRename(tag, trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader className="p-5 pb-3">
            <DialogTitle>{t("tags.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 px-5 pb-5">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("tags.renamePlaceholder")}
              aria-label={t("tags.renamePlaceholder")}
            />
            {reserved !== null && (
              <p className="text-xs text-error">
                {t("tags.addFailedReserved", { prefix: reserved })}
              </p>
            )}
            {collides && reserved === null && (
              <p className="text-xs text-muted">
                {t("tags.renameConflict", { name: trimmed })}
              </p>
            )}
          </div>
          <DialogFooter className="border-t border-border p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {collides ? t("tags.mergeAction") : t("tags.renameAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
