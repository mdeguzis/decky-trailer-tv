// Reads the user's configured Steam power timeouts so Trailer TV fires right
// before SteamOS would dim, and tracks AC vs battery to pick the right values.
// Mostly read-only; the one mutator is the idle-backlight-dim keep-awake write
// (disableIdleBacklightDim / restoreIdleBacklightDim) which goes through Steam's
// own settingsStore so the change reaches gamescope live.

import { findModuleExport } from "@decky/ui";
import { logEvent, getDimSettings } from "./backend";

// SteamClient and settingsStore are injected into the SteamUI global scope.
declare const SteamClient: any;

// Mirror of Steam's EACState (SteamClient.System battery state). Not re-exported
// from @decky/ui's entry point, so we keep a local copy with the exact values.
export enum EACState {
  Unknown = 0,
  Disconnected = 1,
  Connected = 2,
  ConnectedSlow = 3,
}

// Take over this many seconds before Steam's dim, so we beat the OS blank.
const FIRE_BEFORE_SEC = 15;
// Never trigger faster than this (avoids silly values if Steam's dim is tiny).
const MIN_IDLE_SEC = 30;

let onAC = true; // optimistic default so docked users aren't blocked at boot
let unregister: { unregister: () => void } | null = null;

// Track apps that are launching but not yet in GetRunningApps(). bRunning fires
// the moment Steam starts a launch, before the process is registered as running.
const launchingApps = new Set<number>();
let lifetimeReg: { unregister: () => void } | null = null;

export function startAppLifetimeTracking(): void {
  try {
    lifetimeReg = SteamClient.GameSessions?.RegisterForAppLifetimeNotifications?.(
      (data: { unAppID: number; bRunning: boolean }) => {
        if (data.bRunning) {
          launchingApps.add(data.unAppID);
          logEvent("DEBUG", "app lifetime: launching", { appId: data.unAppID });
        } else {
          launchingApps.delete(data.unAppID);
          logEvent("DEBUG", "app lifetime: stopped", { appId: data.unAppID });
        }
      }
    ) ?? null;
  } catch (e) {
    logEvent("WARNING", "app lifetime tracking unavailable", { reason: String(e) });
  }
}

export function stopAppLifetimeTracking(): void {
  try { lifetimeReg?.unregister(); } catch { /* ignore */ }
  lifetimeReg = null;
  launchingApps.clear();
}

/** Subscribe to AC/battery changes. eACState Connected = plugged into power. */
export function startPowerTracking(): void {
  try {
    unregister = SteamClient.System.RegisterForBatteryStateChanges((state: any) => {
      const ac = state?.eACState === EACState.Connected;
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

// Mirror of Steam's EComputerActiveState (drives WebChat idle/active + the
// dim/suspend). Not re-exported from @decky/ui's entry point, so kept local.
export enum EComputerActiveState {
  Invalid = 0,
  Active = 1,
  Idle = 2,
}

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
 * the dim/suspend. `state` is EComputerActiveState (Active / Idle); `time`
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
 * True if a game/app is currently running or launching. Trailer TV must never
 * take over the screen during gameplay. Checks both GetRunningApps() (confirmed
 * running) and the lifetime tracker (launching but not yet registered).
 */
export function isGameRunning(): boolean {
  if (launchingApps.size > 0) return true;
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
    // Prefer the global store; fall back to locating it by a known export
    // (GetClientSetting) in case window.securitystore isn't populated.
    const ss =
      (window as any).securitystore ??
      findModuleExport((e: any) => e?.GetClientSetting && e?.SetActiveLockScreenProps);
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

// --- Idle dim + adaptive brightness (the "settings" keep-awake strategy) ---
// The Deck fades the backlight on an idle timeout owned by gamescope. The only
// thing that changes it live is the msettings protobuf pushed via
// SteamClient.System.UpdateSettings -- the exact call the OS "Dim after" slider
// and the adaptive-brightness toggle make internally. The store wrapper that
// normally builds it (m.Get().SetIdleBacklightDimSeconds) isn't reachable from
// the plugin context, so we build the protobuf by hand. UpdateSettings MERGES
// (the slider sends a single field), so sending only these fields is safe:
//   field 1: idle_backlight_dim_battery_seconds (varint seconds)
//   field 2: idle_backlight_dim_ac_seconds (varint seconds)
//   field 7: display_adaptive_brightness_enabled (varint bool)
const DIM_DISABLED_SECONDS = 86400; // 24h ~= "never" for the length of a session
const DIM_BACKUP_KEY = "trailerTV.idleDimBackup";
const FIELD_DIM_BATTERY = 1;
const FIELD_DIM_AC = 2;
const FIELD_ADAPTIVE_BRIGHTNESS = 7;

interface DimBackup {
  dimBattery: number | null;
  dimAc: number | null;
  adaptive: boolean | null;
}

function readClientSettings(): any {
  return (window as any).settingsStore?.m_ClientSettings ?? null;
}

/** Minimal protobuf varint encoder (values here are small non-negative ints). */
function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = Math.max(0, Math.floor(value));
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

/** Encode one wire-type-0 (varint) protobuf field. */
function protoVarintField(fieldNumber: number, value: number): number[] {
  return [...encodeVarint(fieldNumber << 3), ...encodeVarint(value)];
}

/** Push a partial msettings update live via SteamClient. Throws if unavailable. */
function pushSettings(fields: { num: number; value: number }[]): void {
  const sc = (window as any).SteamClient;
  if (typeof sc?.System?.UpdateSettings !== "function") {
    throw new Error("SteamClient.System.UpdateSettings unavailable");
  }
  const bytes: number[] = [];
  for (const f of fields) bytes.push(...protoVarintField(f.num, f.value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  sc.System.UpdateSettings(btoa(bin));
}

/**
 * Stop the screen dimming while Trailer TV plays: raise both idle backlight-dim
 * timeouts to ~24h and turn off adaptive brightness, in one live UpdateSettings
 * push. Saves the originals (dim from the backend config.vdf, adaptive from the
 * live client settings) to localStorage once, so a crash mid-session is undone
 * on the next restore rather than leaving the dim disabled forever.
 */
export async function disableIdleDim(): Promise<{
  ok: boolean;
  saved?: DimBackup;
  liveAfter?: number | null;
  configAfter?: number | null;
  error?: string;
}> {
  try {
    if (!localStorage.getItem(DIM_BACKUP_KEY)) {
      const dim = await getDimSettings();
      const cs = readClientSettings();
      const backup: DimBackup = {
        dimBattery: dim.battery,
        dimAc: dim.ac,
        adaptive:
          typeof cs?.display_adaptive_brightness_enabled === "boolean"
            ? cs.display_adaptive_brightness_enabled
            : null,
      };
      localStorage.setItem(DIM_BACKUP_KEY, JSON.stringify(backup));
    }
    const saved: DimBackup = JSON.parse(localStorage.getItem(DIM_BACKUP_KEY)!);
    pushSettings([
      { num: FIELD_DIM_BATTERY, value: DIM_DISABLED_SECONDS },
      { num: FIELD_DIM_AC, value: DIM_DISABLED_SECONDS },
      { num: FIELD_ADAPTIVE_BRIGHTNESS, value: 0 },
    ]);
    // Verify the write actually landed: read the live client-settings value and
    // the persisted config.vdf value back. If neither flipped to ~24h, the
    // protobuf didn't apply (vs gamescope ignoring an applied setting).
    const cs = readClientSettings();
    const liveAfter =
      typeof cs?.idle_backlight_dim_ac_seconds === "number"
        ? cs.idle_backlight_dim_ac_seconds
        : null;
    const after = await getDimSettings();
    return { ok: true, saved, liveAfter, configAfter: after.ac };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Restore the dim timeouts + adaptive brightness saved by disableIdleDim. An
 * unknown original adaptive state defaults to on (the Deck default). */
export function restoreIdleDim(): {
  ok: boolean;
  restored?: DimBackup;
  noop?: boolean;
  error?: string;
} {
  try {
    const raw = localStorage.getItem(DIM_BACKUP_KEY);
    if (!raw) return { ok: true, noop: true };
    const saved: DimBackup = JSON.parse(raw);
    const fields: { num: number; value: number }[] = [];
    if (typeof saved.dimBattery === "number") fields.push({ num: FIELD_DIM_BATTERY, value: saved.dimBattery });
    if (typeof saved.dimAc === "number") fields.push({ num: FIELD_DIM_AC, value: saved.dimAc });
    fields.push({ num: FIELD_ADAPTIVE_BRIGHTNESS, value: saved.adaptive === false ? 0 : 1 });
    pushSettings(fields);
    localStorage.removeItem(DIM_BACKUP_KEY);
    return { ok: true, restored: saved };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
