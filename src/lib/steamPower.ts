// Reads the user's configured Steam power timeouts so Trailer TV fires right
// before SteamOS would dim, and tracks AC vs battery to pick the right values.
// Mostly read-only; the one mutator is the idle-backlight-dim keep-awake write
// (disableIdleBacklightDim / restoreIdleBacklightDim) which goes through Steam's
// own settingsStore so the change reaches gamescope live.

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
 * Subscribe to Steam controller input (buttons/sticks) and call `onInput` on any.
 * navigator.getGamepads() is dead in Game Mode's SharedJSContext, so this is the
 * only reliable way to detect controller activity. Returns an unsubscribe fn.
 */
export function startControllerActivity(onInput: () => void): () => void {
  const unsubs: Array<() => void> = [];
  const reg = (fn: ((cb: (...a: any[]) => void) => any) | undefined) => {
    try {
      const handle = fn?.(() => onInput());
      if (handle && typeof handle.unregister === "function") {
        unsubs.push(() => {
          try {
            handle.unregister();
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
  };
  reg(SteamClient.Input?.RegisterForControllerInputMessages?.bind(SteamClient.Input));
  return () => {
    for (const u of unsubs) u();
  };
}

// Steam's own computer active-state (EComputerActiveState).
export const COMPUTER_ACTIVE = 1;
export const COMPUTER_IDLE = 2;

/**
 * Call `onResume` when the Deck wakes from suspend. JS timers freeze during
 * suspend, so on resume our idle clock is stale -- use this to reset it and avoid
 * firing instantly on wake.
 */
export function startResumeReset(onResume: () => void): () => void {
  try {
    const handle = SteamClient.System?.RegisterForOnResumeFromSuspend?.(() => onResume());
    if (handle && typeof handle.unregister === "function") {
      return () => {
        try {
          handle.unregister();
        } catch {
          /* ignore */
        }
      };
    }
  } catch {
    /* ignore */
  }
  return () => {};
}

/**
 * Subscribe to Steam's own idle/active detection -- the same signal that drives
 * the dim/suspend. `state` is EComputerActiveState (1 = Active, 2 = Idle); `time`
 * is a Steam timestamp. This is the non-hacky way to know when the user is idle.
 */
export function startComputerActiveState(
  onChange: (state: number, time: number) => void,
): () => void {
  try {
    const handle = SteamClient.WebChat?.RegisterForComputerActiveStateChange?.(
      (state: number, time: number) => onChange(state, time),
    );
    if (handle && typeof handle.unregister === "function") {
      return () => {
        try {
          handle.unregister();
        } catch {
          /* ignore */
        }
      };
    }
  } catch {
    /* ignore */
  }
  return () => {};
}

// The uinput nudge emits a real input event (to reset gamescope idle) which also
// reaches the UI as a DOM event. Suppress the player's exit-on-input briefly around
// each nudge so the screensaver ignores its own injected input.
let _ignoreExitUntil = 0;
export function suppressExitFor(ms: number): void {
  _ignoreExitUntil = Date.now() + ms;
}
export function exitSuppressed(): boolean {
  return Date.now() < _ignoreExitUntil;
}

/** Re-assert the Steam brightness setting (0-1) to counter the idle backlight dim. */
export function setSteamBrightness(level: number): void {
  try {
    SteamClient.System.Display?.SetBrightness?.(level);
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to display brightness changes -- used to AUDIT whether SteamOS dims
 * the backlight while Trailer TV is active (it shouldn't, once keep-awake works).
 * The payload shape is passed through raw so we log exactly what fired.
 */
export function startBrightnessAudit(onChange: (data: any) => void): () => void {
  try {
    const handle = SteamClient.System.Display?.RegisterForBrightnessChanges?.((d: any) => onChange(d));
    if (handle && typeof handle.unregister === "function") {
      return () => {
        try {
          handle.unregister();
        } catch {
          /* ignore */
        }
      };
    }
  } catch {
    /* ignore */
  }
  return () => {};
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

// --- Lock screen ---------------------------------------------------------
// Steam's Deck lock screen is a SteamUI MobX overlay exposed as
// `window.securitystore`, NOT a system screensaver. `loginctl lock-sessions`
// and `dbus-send org.freedesktop.ScreenSaver.Lock` return ok in Game Mode but
// never render it. The only thing that shows the PIN overlay is setting the
// store's active lock-screen props -- this is exactly what Steam's own
// "lock on wake" does (Di({preventCancel,preventSteamButtons}) -> securitystore
// .SetActiveLockScreenProps).

/**
 * Lock the Deck via Steam's client-side PIN overlay. Only locks when a PIN is
 * configured (`GetSettings().strPIN`); the overlay asserts a PIN is set, so
 * calling it without one is pointless. Returns whether it actually locked.
 */
export function lockSteamScreen(): { ok: boolean; locked: boolean; error?: string } {
  try {
    const ss = (window as any).securitystore;
    if (!ss?.GetSettings || !ss?.SetActiveLockScreenProps) {
      return { ok: false, locked: false, error: "securitystore unavailable" };
    }
    const hasPin = !!ss.GetSettings()?.strPIN;
    if (!hasPin) return { ok: true, locked: false };
    ss.SetActiveLockScreenProps({ preventCancel: true, preventSteamButtons: true });
    return { ok: true, locked: true };
  } catch (e) {
    return { ok: false, locked: false, error: String(e) };
  }
}

// --- Idle backlight dim (the "settings" keep-awake strategy) -------------
// SteamUI writes the dim timeout via settingsStore.SetIdleBacklightDimSeconds,
// which serializes a settings protobuf and pushes it through
// SteamClient.System.UpdateSettings -- the SAME path the OS "Dim after" slider
// uses, so gamescope applies it live. (Writing IdleBacklightDim* to config.vdf
// is persistence only; gamescope does not re-read it without this IPC push.)
const DIM_DISABLED_SECONDS = 86400; // 24h ~= "never" for the length of a session
const DIM_BACKUP_KEY = "trailerTV.idleDimBackup";

interface IdleDimValues {
  ac: number | null;
  battery: number | null;
}

function readIdleBacklightDim(): IdleDimValues {
  try {
    const cs = (window as any).settingsStore?.m_ClientSettings;
    if (!cs) return { ac: null, battery: null };
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return {
      ac: num(cs.idle_backlight_dim_ac_seconds),
      battery: num(cs.idle_backlight_dim_battery_seconds),
    };
  } catch {
    return { ac: null, battery: null };
  }
}

function writeIdleBacklightDim(values: IdleDimValues): void {
  const ss = (window as any).settingsStore;
  if (typeof ss?.SetIdleBacklightDimSeconds !== "function") {
    throw new Error("settingsStore.SetIdleBacklightDimSeconds unavailable");
  }
  // First arg is bOnAC: true = AC value, false = battery value.
  if (typeof values.ac === "number") ss.SetIdleBacklightDimSeconds(true, values.ac);
  if (typeof values.battery === "number") ss.SetIdleBacklightDimSeconds(false, values.battery);
}

/**
 * Raise the idle backlight-dim timeout so gamescope won't dim while Trailer TV
 * plays. Backs the user's current values up to localStorage (crash-safe: a
 * session that dies mid-play is undone by the next settings-run's restore) and
 * only backs up once so re-entry never overwrites the true original with 24h.
 */
export function disableIdleBacklightDim(): {
  ok: boolean;
  saved?: IdleDimValues;
  error?: string;
} {
  try {
    const saved = readIdleBacklightDim();
    if (!localStorage.getItem(DIM_BACKUP_KEY)) {
      localStorage.setItem(DIM_BACKUP_KEY, JSON.stringify(saved));
    }
    writeIdleBacklightDim({ ac: DIM_DISABLED_SECONDS, battery: DIM_DISABLED_SECONDS });
    return { ok: true, saved };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Restore the idle backlight-dim values saved by disableIdleBacklightDim. */
export function restoreIdleBacklightDim(): {
  ok: boolean;
  restored?: IdleDimValues;
  noop?: boolean;
  error?: string;
} {
  try {
    const raw = localStorage.getItem(DIM_BACKUP_KEY);
    if (!raw) return { ok: true, noop: true };
    const saved: IdleDimValues = JSON.parse(raw);
    writeIdleBacklightDim(saved);
    localStorage.removeItem(DIM_BACKUP_KEY);
    return { ok: true, restored: saved };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
