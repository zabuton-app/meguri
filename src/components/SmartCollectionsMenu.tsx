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
              // Three sibling items rather than buttons nested in one: the
              // menu's roving focus treats an item as a single stop and
              // swallows Tab, so a nested button cannot be reached from the
              // keyboard. As items, the arrow keys reach each in turn.
              return (
                <div key={collection.id} className="flex items-start gap-0.5">
                  <DropdownMenuItem
                    onSelect={() => onApply(collection)}
                    className="min-w-0 flex-1 items-start gap-2"
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
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    title={defaultLabel}
                    // Named with the search: every row has the same actions.
                    aria-label={`${defaultLabel}: ${collection.name}`}
                    className={
                      "mt-0.5 size-7 shrink-0 justify-center p-0 [&_svg]:size-3.5 " +
                      (isDefault ? "text-primary" : "text-muted")
                    }
                    onSelect={(event) => {
                      // Toggling the default is not opening the search, and
                      // keeps the menu open to show the new state.
                      event.preventDefault();
                      setDefaultId(isDefault ? null : collection.id);
                    }}
                  >
                    <Star className={isDefault ? "fill-current" : undefined} />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    title={t("smartCollection.delete")}
                    aria-label={`${t("smartCollection.delete")}: ${collection.name}`}
                    className="mt-0.5 size-7 shrink-0 justify-center p-0 text-muted data-[highlighted]:bg-destructive data-[highlighted]:text-destructive-foreground [&_svg]:size-3.5"
                    onSelect={(event) => {
                      event.preventDefault();
                      // The focused item is about to unmount, which would drop
                      // focus to the menu itself and send the next arrow key
                      // back to the top. Hand it to the neighbouring row (or
                      // the menu's first item when none is left) instead.
                      const row = (event.currentTarget as HTMLElement)
                        .parentElement;
                      const menu = row?.closest<HTMLElement>('[role="menu"]');
                      const next =
                        row?.nextElementSibling?.querySelector<HTMLElement>(
                          '[role="menuitem"]',
                        ) ??
                        row?.previousElementSibling?.querySelector<HTMLElement>(
                          '[role="menuitem"]',
                        );
                      removeCollection(collection.id);
                      window.requestAnimationFrame(() =>
                        (
                          next ??
                          menu?.querySelector<HTMLElement>('[role="menuitem"]')
                        )?.focus(),
                      );
                    }}
                  >
                    <Trash2 />
                  </DropdownMenuItem>
                </div>
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
