// Header appearance switcher. Flips between the current theme family's
// light/dark pair (the family itself is picked in Settings).
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { useTheme } from "@/themes/ThemeProvider";

export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const { t } = useI18n();
  const next = mode === "dark" ? "light" : "dark";
  const label = t(
    next === "dark" ? "theme.switchToDark" : "theme.switchToLight",
  );

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-md border border-border text-muted transition hover:bg-fg/10 hover:text-fg",
        className,
      )}
    >
      {next === "dark" ? (
        <Moon className="size-4" />
      ) : (
        <Sun className="size-4" />
      )}
    </button>
  );
}
