import { definePlugin, routerHook } from "@decky/api";
import { staticClasses, Navigation } from "@decky/ui";
import { FaTv } from "react-icons/fa";
import { TrailerPlayer } from "./components/TrailerPlayer";
import { QamPanel } from "./components/QamPanel";
import { getSettings, getDimSettings, logEvent } from "./lib/backend";
import {
  startPowerTracking,
  stopPowerTracking,
  computeIdleSeconds,
  decideIdle,
  isGameRunning,
  isOnAC,
  startControllerActivity,
} from "./lib/steamPower";

const ROUTE = "/trailer-tv";
const TICK_MS = 1000;
const SETTINGS_POLL_MS = 15000;

// Fallback if settings haven't loaded yet. Override live from the CEF console
// with: window.__TRAILER_TV_IDLE_SECONDS__ = 10
const FALLBACK_IDLE_SECONDS = 120;

export interface TrailerTvStatus {
  enabled: boolean;
  active: boolean;
  gameRunning: boolean;
  secondsUntil: number;
  triggerSeconds: number;
  basis: string;
  lastFiredAt: number | null; // epoch ms of the last activation, or null
}

declare global {
  interface Window {
    __TRAILER_TV_START__?: () => void;
    __TRAILER_TV_STOP__?: () => void;
    __TRAILER_TV_ON_EXIT__?: () => void;
    __TRAILER_TV_IDLE_SECONDS__?: number;
    __TRAILER_TV_STATUS__?: () => TrailerTvStatus;
  }
}

/**
 * Watch for input inactivity and navigate to the fullscreen trailer route once
 * idle long enough. Idle threshold comes from settings.idleSeconds (a live CEF
 * console override wins, for testing). Any input while active navigates back.
 * No power gate yet -- that and Steam-power-setting alignment come next.
 */
function startIdleWatcher() {
  let lastActivity = Date.now();
  let active = false;
  let lastFiredAt: number | null = null;
  let enabled = true;
  let customIdleSeconds = 0;
  let fallbackSeconds = FALLBACK_IDLE_SECONDS;
  let dimBattery: number | null = null; // backlight dim seconds (from config.vdf)
  let dimAc: number | null = null;
  let lastLoggedIdle = -1;

  // Backlight-dim seconds for the current power source.
  const currentBacklightDim = () => (isOnAC() ? dimAc : dimBattery);

  // Log the active trigger threshold whenever it changes, so the logs show how
  // long until the screensaver fires without spamming every tick.
  const logIdleIfChanged = () => {
    const d = decideIdle(customIdleSeconds, fallbackSeconds, currentBacklightDim());
    if (d.seconds !== lastLoggedIdle) {
      lastLoggedIdle = d.seconds;
      logEvent("INFO", "idle trigger armed", {
        triggerSeconds: d.seconds,
        basis: d.basis,
        onAC: d.onAC,
        backlightDim: currentBacklightDim(),
      });
    }
  };

  const loadIdle = () =>
    void Promise.all([getSettings(), getDimSettings()])
      .then(([s, dim]) => {
        enabled = s.enabled ?? true;
        customIdleSeconds = s.customIdleSeconds ?? 0;
        fallbackSeconds = s.idleSeconds ?? FALLBACK_IDLE_SECONDS;
        dimBattery = dim.battery;
        dimAc = dim.ac;
        logIdleIfChanged();
      })
      .catch((e) => logEvent("WARNING", "idle settings load failed", { reason: String(e) }));
  loadIdle();
  startPowerTracking();
  logEvent("INFO", "idle watcher started", { fallbackSeconds: FALLBACK_IDLE_SECONDS });

  // Fire right before the first idle action (backlight dim / screen off / suspend),
  // or a custom override. A live CEF console value still wins, for testing.
  const idleMs = () =>
    (window.__TRAILER_TV_IDLE_SECONDS__ ??
      computeIdleSeconds(customIdleSeconds, fallbackSeconds, currentBacklightDim())) * 1000;

  const start = (trigger: string) => {
    if (active) return;
    if (!enabled) {
      logEvent("INFO", "screensaver suppressed: disabled", { trigger });
      return;
    }
    if (isGameRunning()) {
      logEvent("INFO", "screensaver suppressed: game running", { trigger });
      return;
    }
    active = true;
    lastFiredAt = Date.now();
    const d = decideIdle(customIdleSeconds, fallbackSeconds, currentBacklightDim());
    logEvent("INFO", "screensaver activating", {
      trigger,
      basis: d.basis,
      triggerSeconds: d.seconds,
      onAC: d.onAC,
      idleForMs: Date.now() - lastActivity,
    });
    Navigation.Navigate(ROUTE);
  };

  const stop = () => {
    if (!active) return;
    logEvent("INFO", "screensaver stopped manually", {});
    Navigation.NavigateBack();
  };

  // The player owns exit-on-input; it calls this on unmount so we re-arm idle
  // from now no matter how it closed (input, manual, or playback error).
  const onExit = () => {
    active = false;
    lastActivity = Date.now();
  };

  const markActivity = () => {
    lastActivity = Date.now();
  };

  window.__TRAILER_TV_START__ = () => start("manual-global");
  window.__TRAILER_TV_STOP__ = stop;
  window.__TRAILER_TV_ON_EXIT__ = onExit;

  const domEvents: (keyof WindowEventMap)[] = [
    "keydown",
    "mousedown",
    "mousemove",
    "wheel",
    "touchstart",
    "pointermove",
  ];
  const onDom = () => markActivity();
  domEvents.forEach((evt) => window.addEventListener(evt, onDom, true));

  // Controller input isn't DOM events and navigator.getGamepads() is dead in Game
  // Mode, so use Steam's controller input signal to reset the idle clock.
  const stopController = startControllerActivity(markActivity);

  // Countdown status for the QAM (testing aid).
  window.__TRAILER_TV_STATUS__ = () => {
    const targetMs = idleMs();
    const idleForMs = Date.now() - lastActivity;
    const d = decideIdle(customIdleSeconds, fallbackSeconds, currentBacklightDim());
    return {
      enabled,
      active,
      gameRunning: isGameRunning(),
      secondsUntil: Math.max(0, Math.ceil((targetMs - idleForMs) / 1000)),
      triggerSeconds: Math.round(targetMs / 1000),
      basis: d.basis,
      lastFiredAt,
    };
  };

  const tick = window.setInterval(() => {
    if (active) return;
    // Paused or in-game -- keep the idle clock reset so it doesn't immediately
    // fire the moment it's re-enabled or the game exits.
    if (!enabled || isGameRunning()) {
      lastActivity = Date.now();
      return;
    }
    if (Date.now() - lastActivity >= idleMs()) start("idle");
  }, TICK_MS);

  const settingsPoll = window.setInterval(loadIdle, SETTINGS_POLL_MS);

  return () => {
    domEvents.forEach((evt) => window.removeEventListener(evt, onDom, true));
    stopController();
    window.clearInterval(tick);
    window.clearInterval(settingsPoll);
    stopPowerTracking();
    delete window.__TRAILER_TV_START__;
    delete window.__TRAILER_TV_STOP__;
    delete window.__TRAILER_TV_ON_EXIT__;
    delete window.__TRAILER_TV_STATUS__;
  };
}

export default definePlugin(() => {
  logEvent("INFO", "plugin mounted", {});
  routerHook.addRoute(ROUTE, TrailerPlayer, { exact: true });
  const stopWatcher = startIdleWatcher();

  return {
    name: "Trailer TV",
    titleView: <div className={staticClasses.Title}>Trailer TV</div>,
    content: <QamPanel />,
    icon: <FaTv />,
    onDismount() {
      logEvent("INFO", "plugin unmounting", {});
      stopWatcher();
      routerHook.removeRoute(ROUTE);
    },
  };
});
