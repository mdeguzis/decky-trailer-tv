import { useState } from "react";
import { SidebarNavigation } from "@decky/ui";
import type { SidebarNavigationPage } from "@decky/ui";
import { SettingsTab } from "./tabs/SettingsTab";
import { PlaylistTab } from "./tabs/PlaylistTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { LogsTab } from "./tabs/LogsTab";
import { AboutTab } from "./tabs/AboutTab";
import { consumePendingSettingsTab } from "../lib/settingsNav";

// SidebarNavigation expects route values to be full URL subpaths under our
// registered route, NOT bare names -- otherwise Steam pushes /routes/<name> and
// lands on a blank page. The route is registered (non-exact) at
// /trailer-tv-settings, so React Router prefix-matches these subpaths and our
// host component stays mounted. See decky-proton-pulse-patterns.
const ROUTE_PREFIX = "/trailer-tv-settings";
const tabToRoute = (tab: string) => `${ROUTE_PREFIX}/${tab}`;
const routeToTab = (route: string) =>
  route.startsWith(`${ROUTE_PREFIX}/`) ? route.slice(ROUTE_PREFIX.length + 1) : route;

export function SettingsPage() {
  // Initial tab honors a deep-link set by the QAM (e.g. "View playlist"),
  // otherwise lands on Settings.
  const [activePage, setActivePage] = useState(() => consumePendingSettingsTab() ?? "settings");

  const pages: (SidebarNavigationPage | "separator")[] = [
    {
      title: "Settings",
      identifier: "settings",
      route: tabToRoute("settings"),
      content: <SettingsTab />,
    },
    {
      title: "Trailer Playlist",
      identifier: "playlist",
      route: tabToRoute("playlist"),
      content: <PlaylistTab />,
    },
    {
      title: "Trailer History",
      identifier: "history",
      route: tabToRoute("history"),
      content: <HistoryTab />,
    },
    {
      title: "Logs",
      identifier: "logs",
      route: tabToRoute("logs"),
      content: <LogsTab />,
    },
    {
      title: "About",
      identifier: "about",
      route: tabToRoute("about"),
      content: <AboutTab />,
    },
  ];

  return (
    <SidebarNavigation
      pages={pages}
      page={tabToRoute(activePage)}
      onPageRequested={(p) => setActivePage(routeToTab(p))}
      disableRouteReporting={true}
    />
  );
}
