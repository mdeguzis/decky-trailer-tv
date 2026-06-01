import { definePlugin, routerHook } from "@decky/api";
import { staticClasses, Navigation } from "@decky/ui";
import { FaTv } from "react-icons/fa";
import { TrailerPlayer } from "./components/TrailerPlayer";
import { QamPanel } from "./components/QamPanel";
import { getSettings, logEvent } from "./lib/backend";
import { startPowerTracking, stopPowerTracking, computeIdleSeconds } from "./lib/steamPower";

const ROUTE = "/trailer-tv";
const GAMEPAD_POLL_MS = 400;
const TICK_MS = 1000;
const SETTINGS_POLL_MS = 15000;

// Fallback if settings haven't loaded yet. Override live from the CEF console
// with: window.__TRAILER_TV_IDLE_SECONDS__ = 10
const FALLBACK_IDLE_SECONDS = 120;

declare global {
  interface Window {
    __TRAILER_TV_START__?: () => void;
    __TRAILER_TV_STOP__?: () => void;
    __TRAILER_TV_ON_EXIT__?: () => void;
    __TRAILER_TV_IDLE_SECONDS__?: number;
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
  let customIdleSeconds = 0;
  let fallbackSeconds = FALLBACK_IDLE_SECONDS;

  const loadIdle = () =>
    void getSettings()
      .then((s) => {
        customIdleSeconds = s.customIdleSeconds ?? 0;
        fallbackSeconds = s.idleSeconds ?? FALLBACK_IDLE_SECONDS;
      })
      .catch(() => undefined);
  loadIdle();
  startPowerTracking();

  // Fire right before Steam's dim timeout (or a custom override). A live CEF
  // console value still wins, for testing.
  const idleMs = () =>
    (window.__TRAILER_TV_IDLE_SECONDS__ ??
      computeIdleSeconds(customIdleSeconds, fallbackSeconds)) * 1000;

  const start = () => {
    if (active) return;
    active = true;
    logEvent("INFO", "screensaver activating", {
      source: "idleWatcher",
      idleForMs: Date.now() - lastActivity,
    });
    Navigation.Navigate(ROUTE);
  };

  const stop = () => {
    if (!active) return;
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

  window.__TRAILER_TV_START__ = start;
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

  // Gamepad input is not delivered as DOM events in Game Mode, so poll it.
  const gamepadPoll = window.setInterval(() => {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      if (pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.5)) {
        markActivity();
        break;
      }
    }
  }, GAMEPAD_POLL_MS);

  const tick = window.setInterval(() => {
    if (active) return;
    if (Date.now() - lastActivity >= idleMs()) start();
  }, TICK_MS);

  const settingsPoll = window.setInterval(loadIdle, SETTINGS_POLL_MS);

  return () => {
    domEvents.forEach((evt) => window.removeEventListener(evt, onDom, true));
    window.clearInterval(gamepadPoll);
    window.clearInterval(tick);
    window.clearInterval(settingsPoll);
    stopPowerTracking();
    delete window.__TRAILER_TV_START__;
    delete window.__TRAILER_TV_STOP__;
    delete window.__TRAILER_TV_ON_EXIT__;
  };
}

export default definePlugin(() => {
  routerHook.addRoute(ROUTE, TrailerPlayer, { exact: true });
  const stopWatcher = startIdleWatcher();

  return {
    name: "Trailer TV",
    titleView: <div className={staticClasses.Title}>Trailer TV</div>,
    content: <QamPanel />,
    icon: <FaTv />,
    onDismount() {
      stopWatcher();
      routerHook.removeRoute(ROUTE);
    },
  };
});
