// Reads the user's configured Steam power timeouts so Trailer TV fires right
// before SteamOS would dim, and tracks AC vs battery to pick the right values.
// Read-only: this module never mutates Steam settings (the keep-awake write is a
// separate, carefully-tested step).

// SteamClient and settingsStore are injected into the SteamUI global scope.
declare const SteamClient: any;

// Take over this many seconds before Steam's dim, so we beat the OS blank.
const FIRE_BEFORE_SEC = 15;
// Never trigger faster than this (avoids silly values if Steam's dim is tiny).
const MIN_IDLE_SEC = 30;

let onAC = true; // optimistic default so docked users aren't blocked at boot
let unregister: { unregister: () => void } | null = null;

/** Subscribe to AC/battery changes. eACState: 2 = connected to power. */
export function startPowerTracking(): void {
  try {
    unregister = SteamClient.System.RegisterForBatteryStateChanges((state: any) => {
      onAC = state?.eACState === 2;
    });
  } catch {
    onAC = true;
  }
}

export function stopPowerTracking(): void {
  try {
    unregister?.unregister();
  } catch {
    /* ignore */
  }
  unregister = null;
}

export function isOnAC(): boolean {
  return onAC;
}

export interface SteamIdle {
  /** Steam's dim/screensaver timeout for the current power source (0 = disabled). */
  screensaverSec: number;
  /** Steam's suspend/sleep timeout for the current power source. */
  suspendSec: number;
}

/** Read the live Steam idle timeouts for the current power source, or null. */
export function readSteamIdle(): SteamIdle | null {
  try {
    const cs = (window as any).settingsStore?.m_ClientSettings;
    if (!cs) return null;
    const ac = isOnAC();
    return {
      screensaverSec: ac
        ? cs.system_idle_screensaver_ac_sec
        : cs.system_idle_screensaver_battery_sec,
      suspendSec: ac ? cs.system_idle_suspend_ac_sec : cs.system_idle_suspend_battery_sec,
    };
  } catch {
    return null;
  }
}

/**
 * How long to wait before starting Trailer TV.
 * - customIdleSeconds > 0 overrides everything (user must set it below Steam's dim).
 * - else follow Steam's dim minus a small margin; if dim is disabled (0), follow
 *   the suspend timeout minus the margin.
 * - if Steam settings can't be read, fall back to `fallbackSeconds`.
 */
export function computeIdleSeconds(customIdleSeconds: number, fallbackSeconds: number): number {
  if (customIdleSeconds && customIdleSeconds > 0) {
    return Math.max(customIdleSeconds, 1);
  }
  const steam = readSteamIdle();
  if (!steam) return fallbackSeconds;
  const base = steam.screensaverSec > 0 ? steam.screensaverSec : steam.suspendSec;
  if (!base || base <= 0) return fallbackSeconds;
  return Math.max(base - FIRE_BEFORE_SEC, MIN_IDLE_SEC);
}
