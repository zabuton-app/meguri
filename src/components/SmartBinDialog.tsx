import { useState } from "react";
import type { SearchQuery, WorkspaceInfo } from "@/ipc/types";
import { ALL_ID } from "@/ipc/client";
import { FilterBar } from "./FilterBar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import {
  cleanConditions,
  makeSmartCollection,
  type SmartCollection,
} from "@/lib/smartCollections";

/** Mounted afresh for each edit, keeping an unfinished draft local to its dialog. */
export function SmartBinDialog({
  collection,
  query,
  workspaceId,
  workspaces,
  onSave,
  onClose,
}: {
  collection: SmartCollection | null;
  query: SearchQuery;
  workspaceId: string | null;
  workspaces: WorkspaceInfo[];
  onSave: (collection: SmartCollection) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(collection?.name ?? "");
  const [scope, setScope] = useState(
    collection
      ? collection.scope === "all"
        ? ALL_ID
        : (collection.workspaceId ?? "current")
      : ALL_ID,
  );
  const [draft, setDraft] = useState<SearchQuery>(
    collection?.query ?? cleanConditions(query),
  );
  const scopeExists =
    scope === ALL_ID ||
    scope === "current" ||
    workspaces.some((workspace) => workspace.id === scope);
  const save = () => {
    if (!name.trim() || !scopeExists) return;
    const target =
      scope === ALL_ID ? "all" : scope === "current" ? undefined : "workspace";
    const next = makeSmartCollection(
      name,
      draft,
      scope === "current" ? workspaceId : scope,
      target,
    );
    onSave(
      collection
        ? { ...next, id: collection.id, createdAt: collection.createdAt }
        : next,
    );
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogHeader className="p-5 pb-3">
            <DialogTitle>
              {t(collection ? "smartBin.edit" : "smartBin.create")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-5 pb-4">
            <label className="block space-y-1 text-sm">
              <span>{t("smartBin.name")}</span>
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{t("smartBin.scope")}</span>
              <Select
                value={scope}
                onValueChange={(next) => {
                  setScope(next);
                  setDraft(cleanConditions(draft));
                }}
              >
                <SelectTrigger aria-label={t("smartBin.scope")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ID}>{t("smartBin.all")}</SelectItem>
                  {collection &&
                    !collection.scope &&
                    !collection.workspaceId && (
                      <SelectItem value="current">
                        {t("smartBin.current")}
                      </SelectItem>
                    )}
                  {workspaces
                    .filter((workspace) => workspace.id !== ALL_ID)
                    .map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </label>
            {!scopeExists && (
              <p role="alert" className="text-sm text-destructive">
                {t("folder.workspaceGone")}
              </p>
            )}
          </div>
          <FilterBar
            value={draft}
            onChange={setDraft}
            showSaved={false}
            searchInputId="smart-bin-search-input"
          />
          <p className="px-5 py-3 text-xs text-muted">{t("smartBin.live")}</p>
          <DialogFooter className="border-t border-border p-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || !scopeExists}>
              {t("smartCollection.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
