// Lets the QAM deep-link into a specific sidebar tab. The QAM sets the target
// tab, then navigates to the settings route; the SettingsPage host reads (and
// clears) it when it mounts to pick the initial tab. Kept as a module-level
// value rather than threaded through the router because Decky's routerHook
// component takes no props.

let pendingTab: string | null = null;

export function setPendingSettingsTab(tab: string): void {
  pendingTab = tab;
}

export function consumePendingSettingsTab(): string | null {
  const t = pendingTab;
  pendingTab = null;
  return t;
}
