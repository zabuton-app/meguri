// The Home view (issue #123): the screen shown while the virtual "Home"
// workspace is active, in place of the library list. Which arrangement it
// takes is a preference (Settings > General, once there is a choice); each
// arrangement is a layout under ./layouts built from the shared ./shelfParts.
import { memo } from "react";
import { usePreferences } from "@/settings/PreferencesProvider";
import { homeLayoutFor, type HomeLayoutProps } from "./layouts";

export type HomeShelvesProps = HomeLayoutProps;

export const HomeShelves = memo(function HomeShelves(props: HomeShelvesProps) {
  const { homeLayout } = usePreferences();
  const { Component } = homeLayoutFor(homeLayout);
  return <Component {...props} />;
});
