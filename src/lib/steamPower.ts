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

/**
 * True if a game/app is currently running. Trailer TV must never take over the
 * screen during gameplay. Uses the same SteamClient call decky-proton-pulse uses.
 */
export function isGameRunning(): boolean {
  try {
    const apps = SteamClient.GameSessions?.GetRunningApps?.() ?? [];
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

/** Read the screensaver (screen-off) + suspend timeouts from settingsStore. */
function readScreenTimeouts(): { screensaverSec: number; suspendSec: number } {
  try {
    const cs = (window as any).settingsStore?.m_ClientSettings;
    if (!cs) return { screensaverSec: 0, suspendSec: 0 };
    const ac = isOnAC();
    return {
      screensaverSec:
        (ac ? cs.system_idle_screensaver_ac_sec : cs.system_idle_screensaver_battery_sec) || 0,
      suspendSec: (ac ? cs.system_idle_suspend_ac_sec : cs.system_idle_suspend_battery_sec) || 0,
    };
  } catch {
    return { screensaverSec: 0, suspendSec: 0 };
  }
}

export type IdleBasis = "custom" | "backlight-dim" | "screen-off" | "suspend" | "fallback";

export interface IdleDecision {
  seconds: number;
  /** Which timeout produced `seconds` -- useful when a trigger fires unexpectedly. */
  basis: IdleBasis;
  onAC: boolean;
}

/**
 * Decide how long to wait before starting Trailer TV. We fire just before the
 * FIRST thing SteamOS would do on idle for the current power source -- whichever
 * of backlight-dim / screen-off / suspend is the smallest non-zero timeout.
 *
 * - customIdleSeconds > 0 overrides everything.
 * - `backlightDimSec` comes from the backend (config.vdf); the screen-off/suspend
 *   timeouts come from settingsStore.
 * - if nothing is readable, fall back to `fallbackSeconds`.
 */
export function decideIdle(
  customIdleSeconds: number,
  fallbackSeconds: number,
  backlightDimSec: number | null,
): IdleDecision {
  const onAC = isOnAC();
  if (customIdleSeconds && customIdleSeconds > 0) {
    return { seconds: Math.max(customIdleSeconds, 1), basis: "custom", onAC };
  }

  const { screensaverSec, suspendSec } = readScreenTimeouts();
  const candidates: { basis: IdleBasis; sec: number }[] = [];
  if (backlightDimSec && backlightDimSec > 0) candidates.push({ basis: "backlight-dim", sec: backlightDimSec });
  if (screensaverSec > 0) candidates.push({ basis: "screen-off", sec: screensaverSec });
  if (suspendSec > 0) candidates.push({ basis: "suspend", sec: suspendSec });

  if (candidates.length === 0) return { seconds: fallbackSeconds, basis: "fallback", onAC };

  // Fire before the earliest idle action.
  candidates.sort((a, b) => a.sec - b.sec);
  const first = candidates[0];
  return { seconds: Math.max(first.sec - FIRE_BEFORE_SEC, MIN_IDLE_SEC), basis: first.basis, onAC };
}

/** Convenience wrapper returning just the seconds (used by the idle tick). */
export function computeIdleSeconds(
  customIdleSeconds: number,
  fallbackSeconds: number,
  backlightDimSec: number | null,
): number {
  return decideIdle(customIdleSeconds, fallbackSeconds, backlightDimSec).seconds;
}
