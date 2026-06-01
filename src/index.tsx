import { definePlugin, routerHook } from "@decky/api";
import { staticClasses, Navigation, PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaTv } from "react-icons/fa";

const ROUTE = "/trailer-tv";

// SPIKE TUNING -- short idle window so we can test without waiting minutes.
// Override live from the CEF console with: window.__TRAILER_TV_IDLE_SECONDS__ = 10
const DEFAULT_IDLE_SECONDS = 20;
const GAMEPAD_POLL_MS = 400;
const TICK_MS = 1000;

declare global {
  interface Window {
    __TRAILER_TV_START__?: () => void;
    __TRAILER_TV_STOP__?: () => void;
    __TRAILER_TV_IDLE_SECONDS__?: number;
  }
}

function log(message: string, extra?: Record<string, unknown>) {
  // Visible in `make get-cef-capture` / the CEF console.
  console.log(`[trailer-tv] ${message}`, extra ?? "");
}

function SpikeFullscreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "black",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 40,
        gap: 16,
        zIndex: 99999,
      }}
      onClick={() => Navigation.NavigateBack()}
    >
      <div>Trailer TV (spike)</div>
      <div style={{ fontSize: 22, color: "#9ad" }}>
        idle-triggered screensaver placeholder
      </div>
      <div style={{ fontSize: 18, color: "#888" }}>any input exits</div>
    </div>
  );
}

function QamSpike() {
  return (
    <PanelSection title="Trailer TV (spike)">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => window.__TRAILER_TV_START__?.()}>
          Start now
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => window.__TRAILER_TV_STOP__?.()}>
          Stop
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

/**
 * Self-contained idle watcher for the spike. Tracks the last input time across
 * DOM events and gamepad polling; when idle long enough, navigates to the
 * fullscreen route. Any input while active navigates back. No backend / power
 * gate yet -- this exists purely to prove idle-fire works in Game Mode.
 */
function startIdleWatcher() {
  let lastActivity = Date.now();
  let active = false;

  const idleMs = () => (window.__TRAILER_TV_IDLE_SECONDS__ ?? DEFAULT_IDLE_SECONDS) * 1000;

  const start = () => {
    if (active) return;
    active = true;
    log("activating screensaver", { idleForMs: Date.now() - lastActivity });
    Navigation.Navigate(ROUTE);
  };

  const stop = () => {
    if (!active) return;
    active = false;
    log("dismissing screensaver");
    Navigation.NavigateBack();
  };

  const markActivity = (source: string) => {
    lastActivity = Date.now();
    if (active) {
      log("input during screensaver -> dismiss", { source });
      stop();
    }
  };

  // Manual/remote hooks.
  window.__TRAILER_TV_START__ = start;
  window.__TRAILER_TV_STOP__ = stop;

  const domEvents: (keyof WindowEventMap)[] = [
    "keydown",
    "mousedown",
    "mousemove",
    "wheel",
    "touchstart",
    "pointermove",
  ];
  const onDom = (e: Event) => markActivity(e.type);
  domEvents.forEach((evt) => window.addEventListener(evt, onDom, true));

  // Gamepad input is not delivered as DOM events in Game Mode, so poll it.
  const gamepadPoll = window.setInterval(() => {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const pressed = pad.buttons.some((b) => b.pressed);
      const moved = pad.axes.some((a) => Math.abs(a) > 0.5);
      if (pressed || moved) {
        markActivity("gamepad");
        break;
      }
    }
  }, GAMEPAD_POLL_MS);

  const tick = window.setInterval(() => {
    if (active) return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= idleMs()) {
      start();
    }
  }, TICK_MS);

  log("idle watcher started", { defaultIdleSeconds: DEFAULT_IDLE_SECONDS });

  return () => {
    domEvents.forEach((evt) => window.removeEventListener(evt, onDom, true));
    window.clearInterval(gamepadPoll);
    window.clearInterval(tick);
    delete window.__TRAILER_TV_START__;
    delete window.__TRAILER_TV_STOP__;
  };
}

export default definePlugin(() => {
  routerHook.addRoute(ROUTE, SpikeFullscreen, { exact: true });
  const stopWatcher = startIdleWatcher();

  return {
    name: "Trailer TV",
    titleView: <div className={staticClasses.Title}>Trailer TV</div>,
    content: <QamSpike />,
    icon: <FaTv />,
    onDismount() {
      stopWatcher();
      routerHook.removeRoute(ROUTE);
    },
  };
});
