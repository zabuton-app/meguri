// The playback speed control (#280): a button showing the speed, opening the
// list of speeds. Shared by the video control bar and the audio controls.
import { useState } from "react";
import { Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n/I18nProvider";
import { PLAYBACK_SPEEDS } from "@/lib/playbackSpeed";
import { cn } from "@/lib/utils";

interface Props {
  speed: number;
  onChange: (speed: number) => void;
  disabled?: boolean;
  /** The trigger's look, from its control bar. */
  className: string;
  /** "dark": the clip player's panel, for controls over a picture (the video
   *  bar, the audio detail's stage); "theme": the app's colours. */
  look: "dark" | "theme";
  /** The element to render the list in: the one that goes fullscreen. */
  portalTarget?: () => HTMLElement | null;
}

export function SpeedMenu({
  speed,
  onChange,
  disabled,
  className,
  look,
  portalTarget,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const title = t("player.speed");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setContainer(portalTarget?.() ?? null);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={`${title}: ${t("player.speedValue", { speed })}`}
          disabled={disabled}
          className={cn(
            "min-w-11 text-xs tabular-nums",
            className,
            look === "dark" &&
              "data-[state=open]:bg-white/20 data-[state=open]:text-white",
          )}
          // The players' shortcuts take Space on a focused button as play or
          // pause; here it has to open the list.
          onKeyDown={(event) => {
            if (event.code === "Space") event.stopPropagation();
          }}
        >
          {t("player.speedValue", { speed })}
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        side="top"
        align="end"
        aria-label={title}
        className={cn(
          "w-auto p-1",
          look === "dark" && "border-white/15 bg-black/90 text-white",
        )}
      >
        <div role="radiogroup" aria-label={title} className="flex flex-col">
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === speed}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded px-2.5 py-1 text-left text-sm tabular-nums",
                look === "dark" ? "hover:bg-white/15" : "hover:bg-fg/10",
              )}
            >
              <Check
                size={14}
                className={s === speed ? "opacity-100" : "opacity-0"}
              />
              {t("player.speedValue", { speed: s })}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
