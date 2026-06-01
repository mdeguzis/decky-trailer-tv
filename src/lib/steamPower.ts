// Reads the user's configured Steam power timeouts so Trailer TV fires right
// before SteamOS would dim, and tracks AC vs battery to pick the right values.
// Read-only: this module never mutates Steam settings (the keep-awake write is a
// separate, carefully-tested step).

import { logEvent } from "./backend";

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
      const ac = state?.eACState === 2;
      if (ac !== onAC) {
        onAC = ac;
        logEvent("INFO", "power source changed", {
          onAC: ac,
          source: "SteamClient.System.RegisterForBatteryStateChanges",
          field: "eACState",
        });
      }
    });
    logEvent("DEBUG", "power tracking started", { onAC });
  } catch (e) {
    onAC = true;
    logEvent("WARNING", "power tracking unavailable, assuming AC", { reason: String(e) });
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

export interface IdleDecision {
  seconds: number;
  /** Which input produced `seconds` -- useful when a trigger fires unexpectedly. */
  basis: "custom" | "steam-dim" | "steam-suspend" | "fallback";
  onAC: boolean;
}

/**
 * Decide how long to wait before starting Trailer TV, with the basis for logging.
 * - customIdleSeconds > 0 overrides everything (user must set it below Steam's dim).
 * - else follow Steam's dim minus a small margin; if dim is disabled (0), follow
 *   the suspend timeout minus the margin.
 * - if Steam settings can't be read, fall back to `fallbackSeconds`.
 */
export function decideIdle(customIdleSeconds: number, fallbackSeconds: number): IdleDecision {
  const onAC = isOnAC();
  if (customIdleSeconds && customIdleSeconds > 0) {
    return { seconds: Math.max(customIdleSeconds, 1), basis: "custom", onAC };
  }
  const steam = readSteamIdle();
  if (!steam) return { seconds: fallbackSeconds, basis: "fallback", onAC };
  if (steam.screensaverSec > 0) {
    return { seconds: Math.max(steam.screensaverSec - FIRE_BEFORE_SEC, MIN_IDLE_SEC), basis: "steam-dim", onAC };
  }
  if (steam.suspendSec > 0) {
    return { seconds: Math.max(steam.suspendSec - FIRE_BEFORE_SEC, MIN_IDLE_SEC), basis: "steam-suspend", onAC };
  }
  return { seconds: fallbackSeconds, basis: "fallback", onAC };
}

/** Convenience wrapper returning just the seconds (used by the idle tick). */
export function computeIdleSeconds(customIdleSeconds: number, fallbackSeconds: number): number {
  return decideIdle(customIdleSeconds, fallbackSeconds).seconds;
}
