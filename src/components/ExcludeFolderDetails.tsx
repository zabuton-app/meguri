// What excluding a folder from scans does (#529), under the confirmation's
// question: the folder on disk with its name picked out, so it reads as that
// one folder and not every folder of that name, then what happens to it.
import { EyeOff, Folder, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";

/** The folder on disk, split before its name. */
function onDisk(
  root: string | null,
  folder: string,
): { parent: string; name: string } {
  const at = folder.lastIndexOf("/");
  const name = folder.slice(at + 1);
  const inside = at === -1 ? "" : folder.slice(0, at + 1);
  if (root === null) return { parent: inside, name };
  // In the OS's form, as the root is written.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const base = root.endsWith(sep) ? root : root + sep;
  return { parent: base + inside.split("/").join(sep), name };
}

export function ExcludeFolderDetails({
  root,
  folder,
  count,
}: {
  /** The workspace root, or null when it could not be read. */
  root: string | null;
  /** Relative to the root, "/"-separated. */
  folder: string;
  count: number;
}) {
  const { t } = useI18n();
  const { parent, name } = onDisk(root, folder);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-md border border-border bg-bg px-3 py-2">
        <span className="text-xs text-muted">{t("folder.excludeTarget")}</span>
        <p className="break-all font-mono text-xs text-muted">
          {parent}
          <mark className="rounded-sm bg-primary/20 px-0.5 font-medium text-bright-fg">
            {name}
          </mark>
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-sm text-fg">
        <Point icon={<EyeOff />}>{t("folder.excludeHides", { count })}</Point>
        <Point icon={<Folder />}>{t("folder.excludeOnlyThis", { name })}</Point>
        <Point icon={<Undo2 />} muted>
          {t("folder.excludeUndoHint")}
        </Point>
      </ul>
    </div>
  );
}

function Point({
  icon,
  muted,
  children,
}: {
  icon: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={muted ? "flex gap-2 text-muted" : "flex gap-2"}>
      <span
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-primary [&>svg]:size-4"
      >
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
