// The app's logo mark, in the variant picked in Settings > App logo. It sits
// at the top of the workspace rail's column: in the title bar above the rail,
// or at the top of the rail while the window buttons take the bar's left end
// (#578).
import { useLogo, useLogoImages } from "@/hooks/useLogo";
import { appName } from "@/lib/appName";
import { cn } from "@/lib/utils";

export function AppLogo({ className }: { className: string }) {
  const { logo } = useLogo();
  const logoImages = useLogoImages();
  // The bitmaps arrive from main just after the first paint; hold the space
  // meanwhile, without an <img> that would show its alt text.
  return logoImages ? (
    <img
      src={logoImages[logo]}
      alt={appName()}
      draggable={false}
      className={cn("shrink-0", className)}
    />
  ) : (
    <div className={cn("shrink-0", className)} />
  );
}
