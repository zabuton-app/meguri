import {
  DatabaseBackup,
  Grid3X3,
  HelpCircle,
  List,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Table2,
  Terminal,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";

type ViewMode = "grid" | "list" | "table";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ready: boolean;
  scanning: boolean;
  devToolsEnabled: boolean;
  onFocusSearch: () => void;
  onScan: (includeExcluded?: boolean) => void;
  onRebuild: () => void;
  onSetView: (view: ViewMode) => void;
  onDiscover: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onOpenDevTools: () => void;
}

interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

function shortcutMeta(): string {
  return navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl+K";
}

function shortcutDevTools(): string {
  return navigator.platform.toLowerCase().includes("mac")
    ? "⌘⇧I"
    : "Ctrl+Shift+I";
}

function action(
  t: TFunc,
  key: TranslationKey,
  props: Omit<CommandAction, "label">,
): CommandAction {
  return { ...props, label: t(key) };
}

export function CommandMenu({
  open,
  onOpenChange,
  ready,
  scanning,
  devToolsEnabled,
  onFocusSearch,
  onScan,
  onRebuild,
  onSetView,
  onDiscover,
  onSettings,
  onHelp,
  onOpenDevTools,
}: CommandMenuProps) {
  const { t } = useI18n();
  const closeThen = (fn: () => void) => {
    onOpenChange(false);
    window.setTimeout(fn, 0);
  };

  const navigation: CommandAction[] = [
    action(t, "command.focusSearch", {
      id: "focus-search",
      icon: Search,
      shortcut: "/",
      run: () => closeThen(onFocusSearch),
    }),
    action(t, "discover.title", {
      id: "discover",
      icon: Sparkles,
      disabled: !ready,
      run: () => closeThen(onDiscover),
    }),
    action(t, "settings.title", {
      id: "settings",
      icon: Settings,
      run: () => closeThen(onSettings),
    }),
    action(t, "shortcuts.title", {
      id: "help",
      icon: HelpCircle,
      shortcut: "?",
      run: () => closeThen(onHelp),
    }),
  ];
  if (devToolsEnabled) {
    navigation.push(
      action(t, "command.openDevTools", {
        id: "open-devtools",
        icon: Terminal,
        shortcut: shortcutDevTools(),
        run: () => closeThen(onOpenDevTools),
      }),
    );
  }

  const workspace = [
    action(t, "home.scan", {
      id: "scan",
      icon: RefreshCw,
      disabled: scanning || !ready,
      run: () => closeThen(() => onScan()),
    }),
    action(t, "home.scanWithDeleted", {
      id: "resync",
      icon: RefreshCw,
      disabled: scanning || !ready,
      run: () => closeThen(() => onScan(true)),
    }),
    action(t, "home.rebuildIndex", {
      id: "rebuild",
      icon: DatabaseBackup,
      disabled: scanning || !ready,
      run: () => closeThen(onRebuild),
    }),
  ];

  const view = [
    action(t, "view.grid", {
      id: "view-grid",
      icon: Grid3X3,
      run: () => closeThen(() => onSetView("grid")),
    }),
    action(t, "view.list", {
      id: "view-list",
      icon: List,
      run: () => closeThen(() => onSetView("list")),
    }),
    action(t, "view.table", {
      id: "view-table",
      icon: Table2,
      run: () => closeThen(() => onSetView("table")),
    }),
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("command.title")}
      description={t("command.placeholder")}
      className="max-w-xl border-muted/35 bg-bg shadow-2xl"
    >
      <Command>
        <CommandInput placeholder={t("command.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("command.empty")}</CommandEmpty>
          <CommandActionGroup
            heading={t("command.groupNavigation")}
            actions={navigation}
          />
          <CommandSeparator />
          <CommandActionGroup
            heading={t("command.groupWorkspace")}
            actions={workspace}
          />
          <CommandSeparator />
          <CommandActionGroup heading={t("command.groupView")} actions={view} />
        </CommandList>
        <div className="border-t border-border px-3 py-2 text-xs text-muted">
          {t("command.shortcutHint", { shortcut: shortcutMeta() })}
        </div>
      </Command>
    </CommandDialog>
  );
}

function CommandActionGroup({
  heading,
  actions,
}: {
  heading: string;
  actions: CommandAction[];
}) {
  return (
    <CommandGroup heading={heading}>
      {actions.map(({ id, label, shortcut, disabled, icon: Icon, run }) => (
        <CommandItem key={id} value={label} disabled={disabled} onSelect={run}>
          <Icon />
          <span>{label}</span>
          {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
