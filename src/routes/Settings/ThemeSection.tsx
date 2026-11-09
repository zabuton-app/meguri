// Settings: the theme grid. The built-in families come first, then the CSS
// theme files from <userData>/themes. Picking a file layers it over the stored
// family, which stays underneath and covers whatever the file leaves out;
// picking a family again drops the file.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { useTheme } from "@/themes/ThemeProvider";
import { deriveTokens, type Token } from "@/themes/derive";
import { useCssThemes } from "@/hooks/useCssThemes";
import { useI18n } from "@/i18n/I18nProvider";

// Swatches for the theme picker. Derived tokens, not raw palette slots, so what the swatch
// shows is what the UI will actually use — and the chrome colors that used to be invisible in
// some themes (hairlines, secondary text) can be judged before switching.
const PREVIEW_TOKENS: Token[] = [
  "bg",
  "border",
  "muted",
  "primary",
  "accent2",
  "error",
];

/** One swatch cell; the CSS badge spans as many. */
const SWATCH_PX = 16;

function ThemeCard({
  active,
  disabled,
  onClick,
  preview,
  name,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  preview: ReactNode;
  name: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2 text-left transition disabled:opacity-60 " +
        (active
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-primary")
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 overflow-hidden rounded-[3px] border border-border">
          {preview}
        </span>
        <span className="truncate text-sm text-fg">{name}</span>
      </span>
      {active && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

export function ThemeSection() {
  const { t } = useI18n();
  const { mode, familyId, families, setFamily } = useTheme();
  const cssThemes = useCssThemes();
  const cssSelected = cssThemes.state?.selected ?? null;

  const pickFamily = (id: string) => {
    setFamily(id);
    // Always, not only when a file shows as picked: a picked file that is
    // missing for now reads as none here but stays stored, and a pick still in
    // flight would land afterwards. Picks run in order, so this one wins.
    cssThemes.select(null);
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-bright-fg">
        {t("settings.theme")}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {families.map((fam) => {
          // Preview the variant for the current appearance (or the paired variant if absent).
          const variant = fam[mode] ?? fam.dark ?? fam.light;
          if (!variant) return null;
          const swatch = deriveTokens(variant);
          return (
            <ThemeCard
              key={fam.id}
              active={!cssSelected && fam.id === familyId}
              onClick={() => pickFamily(fam.id)}
              name={fam.name}
              preview={PREVIEW_TOKENS.map((token) => (
                <span
                  key={token}
                  style={{
                    width: SWATCH_PX,
                    height: SWATCH_PX,
                    backgroundColor: swatch[token],
                  }}
                />
              ))}
            />
          );
        })}
        {cssThemes.state?.themes.map((theme) => (
          <ThemeCard
            key={`css:${theme.file}`}
            active={theme.file === cssSelected}
            disabled={cssThemes.pending}
            onClick={() => cssThemes.select(theme.file)}
            name={theme.name}
            // No palette to preview: the file is arbitrary CSS.
            preview={
              <span
                className="flex items-center justify-center font-mono text-[10px] text-muted"
                style={{
                  width: PREVIEW_TOKENS.length * SWATCH_PX,
                  height: SWATCH_PX,
                }}
              >
                CSS
              </span>
            }
          />
        ))}
      </div>
    </section>
  );
}
