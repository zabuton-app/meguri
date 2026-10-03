import { useEffect, useMemo, useState } from "react";
import { Bookmark, BookmarkPlus, Star, Trash2 } from "lucide-react";
import type { SearchQuery } from "@/ipc/types";
import type { SmartCollectionsState } from "@/hooks/useSmartCollections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/I18nProvider";
import {
  cleanSearchQuery,
  describeSearchQuery,
  hasSearchConditions,
  type SmartCollection,
} from "@/lib/smartCollections";

interface Props {
  value: SearchQuery;
  /** The real workspace shown, saved with a folder condition (see makeSmartCollection). */
  workspaceId?: string | null;
  onApply: (collection: SmartCollection) => void;
  /**
   * The saved searches, owned by the filter bar: "Clear all" there returns to
   * the default picked here, so both have to read the same state.
   */
  smart: SmartCollectionsState;
}

export function SmartCollectionsMenu({
  value,
  workspaceId,
  onApply,
  smart,
}: Props) {
  const { t } = useI18n();
  const {
    collections,
    defaultId,
    addCollection,
    removeCollection,
    setDefaultId,
  } = smart;
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const canSave = hasSearchConditions(value);

  // The full condition summary doubles as the default name, so the dialog can
  // be confirmed as-is and the saved entry still says what it filters.
  const summary = useMemo(
    () => describeSearchQuery(t, cleanSearchQuery(value)),
    [t, value],
  );

  useEffect(() => {
    // Initializing the edit-form state with the default name when the save dialog opens is a legitimate pattern, so synchronous setState is allowed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saveOpen) setName(summary);
  }, [summary, saveOpen]);

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addCollection(trimmed, value, workspaceId);
    setSaveOpen(false);
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={t("smartCollection.title")}
            aria-label={t("smartCollection.title")}
          >
            <Bookmark />
            <span className="hidden sm:inline">
              {t("smartCollection.shortTitle")}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuItem
            disabled={!canSave}
            onSelect={() => {
              if (!canSave) return;
              setMenuOpen(false);
              window.requestAnimationFrame(() => setSaveOpen(true));
            }}
          >
            <BookmarkPlus />
            {t("smartCollection.saveCurrent")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {collections.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted">
              {t("smartCollection.empty")}
            </div>
          ) : (
            collections.map((collection) => {
              const isDefault = collection.id === defaultId;
              const defaultLabel = isDefault
                ? t("smartCollection.unsetDefault")
                : t("smartCollection.setDefault");
              return (
                <DropdownMenuItem
                  key={collection.id}
                  onSelect={() => onApply(collection)}
                  className="items-start gap-2 pr-1"
                >
                  <Bookmark className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {collection.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {describeSearchQuery(t, collection.query)}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-slot="smart-collection-default"
                    aria-pressed={isDefault}
                    title={defaultLabel}
                    aria-label={defaultLabel}
                    className={
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface " +
                      (isDefault ? "text-primary" : "text-muted hover:text-fg")
                    }
                    onClick={(event) => {
                      // Toggling the default is not opening the search.
                      event.preventDefault();
                      event.stopPropagation();
                      setDefaultId(isDefault ? null : collection.id);
                    }}
                  >
                    <Star
                      className={
                        "size-3.5" + (isDefault ? " fill-current" : "")
                      }
                    />
                  </button>
                  <button
                    type="button"
                    title={t("smartCollection.delete")}
                    aria-label={t("smartCollection.delete")}
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-destructive hover:text-destructive-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeCollection(collection.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <DialogHeader className="p-5 pb-3">
              <DialogTitle>{t("smartCollection.saveTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 px-5 pb-5">
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("smartCollection.namePlaceholder")}
              />
              <p className="select-text text-xs text-muted">{summary}</p>
            </div>
            <DialogFooter className="border-t border-border p-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {t("smartCollection.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
