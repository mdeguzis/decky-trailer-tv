import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Navigation } from "@decky/ui";
import {
  getPlaylist,
  getSettings,
  getBacklight,
  getLockScreenSettings,
  lockScreen,
  nudgeInput,
  stopKeepAwake,
  disableDim,
  restoreDim,
  recordPlayedClip,
  logEvent,
} from "../lib/backend";
import {
  startControllerActivity,
  startBrightnessAudit,
  setSteamBrightness,
  suppressExitFor,
  exitSuppressed,
} from "../lib/steamPower";
import type { Settings, TrailerClip } from "../lib/types";

const UINPUT_NUDGE_MS = 5000;

/** Advance a playlist cursor, wrapping at the end. Empty playlist -> 0. */
function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0;
  return (current + 1) % length;
}

// Ignore input for a moment after launch so the button/tap that started the
// screensaver doesn't immediately dismiss it.
const INPUT_GRACE_MS = 700;

export function TrailerPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [clips, setClips] = useState<TrailerClip[]>([]);
  const [index, setIndex] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const failuresRef = useRef(0);
  const knownAppidsRef = useRef<Set<number>>(new Set());
  const hasPinRef = useRef(false);

  // Exit on ANY input, like a real idle/sleep screensaver -- regardless of how
  // it was launched (idle trigger or the QAM "Test" button). Notifies the idle
  // watcher on unmount so it re-arms from now.
  useEffect(() => {
    const armAt = Date.now() + INPUT_GRACE_MS;
    let exited = false;

    const exit = (source: string) => {
      // Ignore our own injected uinput nudge (the "input TT ignores").
      if (exited || Date.now() < armAt || exitSuppressed()) return;
      exited = true;
      logEvent("INFO", "screensaver exited by input", { source, lockPending: hasPinRef.current });
      if (hasPinRef.current) {
        // Try Steam's own client-side lock API first (loginctl does not reach
        // Steam's internal PIN lock screen in game mode).
        const sc = (window as any).SteamClient;
        const auth = sc?.Auth;
        const user = sc?.User;
        const sys  = sc?.System;
        const authKeys = auth ? Object.keys(auth).filter((k: string) => typeof auth[k] === "function") : [];
        const userKeys = user ? Object.keys(user).filter((k: string) => typeof user[k] === "function") : [];
        void logEvent("DEBUG", "client lock probe", { authKeys: authKeys.join(","), userKeys: userKeys.join(",") });

        let locked = false;
        if (typeof auth?.LockSteamWithPIN === "function")      { auth.LockSteamWithPIN();      void logEvent("INFO", "client lock: Auth.LockSteamWithPIN"); locked = true; }
        else if (typeof auth?.LockSteam === "function")        { auth.LockSteam();             void logEvent("INFO", "client lock: Auth.LockSteam"); locked = true; }
        else if (typeof user?.LockSteam === "function")        { user.LockSteam();             void logEvent("INFO", "client lock: User.LockSteam"); locked = true; }
        else if (typeof sys?.LockScreen === "function")        { sys.LockScreen();             void logEvent("INFO", "client lock: System.LockScreen"); locked = true; }

        if (!locked) {
          // No known Steam client lock API found; fall back to loginctl.
          void logEvent("WARNING", "client lock: no known method, falling back to backend");
          void lockScreen().then((r) =>
            logEvent(r.ok ? "INFO" : "WARNING", "lock_screen result", r as object)
          );
        }
        Navigation.NavigateBack();
      } else {
        Navigation.NavigateBack();
      }
    };

    const domEvents: (keyof WindowEventMap)[] = [
      "keydown",
      "mousedown",
      "mousemove",
      "wheel",
      "touchstart",
      "pointerdown",
      "pointermove",
    ];
    const onDom = (e: Event) => exit(e.type);
    domEvents.forEach((evt) => window.addEventListener(evt, onDom, true));

    // Controller buttons/sticks aren't DOM events and getGamepads() is dead in
    // Game Mode, so use Steam's controller input signal to dismiss.
    const stopController = startControllerActivity(() => exit("controller"));

    return () => {
      domEvents.forEach((evt) => window.removeEventListener(evt, onDom, true));
      stopController();
      window.__TRAILER_TV_ON_EXIT__?.();
    };
  }, []);

  // KEEP-AWAKE + DIM AUDIT. The sysfs backlight poll always runs and logs real
  // dims (RegisterForBrightnessChanges is blind to them), so we can SEE which
  // strategy actually holds the screen. The strategy then acts:
  //   - brightness: re-assert the user's brightness setting on a drop
  //   - uinput: emit a real input nudge to reset gamescope idle (prevents dim
  //             AND screen-off AND suspend), suppressing self-exit around it
  //   - off: audit only
  const strategy = settings?.keepAwakeStrategy ?? "uinput";
  useEffect(() => {
    if (!settings) return;
    logEvent("INFO", "keep-awake started", { strategy });
    let baselineRaw: number | null = null;
    let savedBrightness: number | null = null;
    let cancelled = false;

    const stopBrightness = startBrightnessAudit((data) => {
      if (typeof data?.flBrightness === "number" && data.flBrightness > 0) {
        savedBrightness = data.flBrightness;
      }
    });

    const poll = async () => {
      const bl = await getBacklight();
      if (cancelled || bl.raw === null) return;
      if (baselineRaw === null || bl.raw > baselineRaw) {
        baselineRaw = bl.raw;
        return;
      }
      if (bl.raw < baselineRaw * 0.9) {
        logEvent("WARNING", "DIM during Trailer TV (backlight dropped)", {
          fromRaw: baselineRaw,
          toRaw: bl.raw,
          ratio: bl.ratio,
          strategy,
        });
        if (strategy === "brightness" && savedBrightness !== null) {
          setSteamBrightness(savedBrightness);
        }
      }
    };
    void poll();
    const auditId = window.setInterval(() => void poll(), 1500);

    // settings route: raise the dim timeout so gamescope never dims.
    if (strategy === "settings") {
      void disableDim().then((r) => logEvent("INFO", "disable_dim", r as object));
    }

    // uinput nudge loop.
    let nudgeId = 0;
    if (strategy === "uinput") {
      let nudgeCount = 0;
      const nudge = async () => {
        suppressExitFor(700);
        const r = await nudgeInput();
        nudgeCount += 1;
        // Log first few + every 12th (~once/min) at INFO so we confirm it runs.
        if (nudgeCount <= 3 || nudgeCount % 12 === 0) {
          logEvent("INFO", "uinput nudge", { ...r, n: nudgeCount });
        }
      };
      void nudge();
      nudgeId = window.setInterval(() => void nudge(), UINPUT_NUDGE_MS);
    }

    return () => {
      cancelled = true;
      window.clearInterval(auditId);
      if (nudgeId) window.clearInterval(nudgeId);
      stopBrightness();
      if (strategy === "uinput") void stopKeepAwake();
      if (strategy === "settings") void restoreDim().then((r) => logEvent("INFO", "restore_dim", r as object));
      logEvent("INFO", "keep-awake stopped", { strategy });
    };
  }, [settings, strategy]);

  // Load playlist + settings on mount; the backend may return a partial list while
  // the background fill is running, so we also poll to append new clips as they arrive.
  useEffect(() => {
    void (async () => {
      try {
        const [pl, s, lock] = await Promise.all([getPlaylist(false), getSettings(), getLockScreenSettings()]);
        setSettings(s);
        pl.forEach((c) => knownAppidsRef.current.add(c.appid));
        setClips(pl);
        hasPinRef.current = lock.has_pin;
        logEvent("INFO", "TrailerPlayer mounted", {
          source: s.source,
          count: pl.length,
          lockOnExit: lock.has_pin,
        });
      } finally {
        setLoading(false);
      }
    })();

    // Poll every 20s and append any newly-built clips without disrupting playback.
    const pollId = window.setInterval(() => {
      void getPlaylist(false).then((pl) => {
        setClips((prev) => {
          const incoming = pl.filter((c) => !knownAppidsRef.current.has(c.appid));
          if (incoming.length === 0) return prev;
          incoming.forEach((c) => knownAppidsRef.current.add(c.appid));
          logEvent("DEBUG", "playlist poll: appended clips", {
            added: incoming.length,
            total: prev.length + incoming.length,
          });
          return [...prev, ...incoming];
        });
      });
    }, 20_000);

    return () => window.clearInterval(pollId);
  }, []);

  const current = clips[index];

  // Attach hls.js whenever the current clip changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;

    let hls: Hls | null = null;
    const advance = () =>
      setIndex((i) => {
        const next = nextIndex(i, clips.length);
        // Wrapped around to the start -- request a fresh batch so new items are
        // appended before the player loops back to clips it already showed.
        if (next === 0) {
          void getPlaylist(true).then((pl) => {
            setClips((prev) => {
              const incoming = pl.filter((c) => !knownAppidsRef.current.has(c.appid));
              if (incoming.length === 0) return prev;
              incoming.forEach((c) => knownAppidsRef.current.add(c.appid));
              logEvent("DEBUG", "playlist wrap: appended clips", {
                added: incoming.length,
                total: prev.length + incoming.length,
              });
              return [...prev, ...incoming];
            });
          });
        }
        return next;
      });

    logEvent("DEBUG", "playing clip", {
      appid: current.appid,
      name: current.name,
      index,
      total: clips.length,
      engine: Hls.isSupported() ? "hls.js" : "native",
    });
    void recordPlayedClip(current.appid, current.name);

    const onError = (reason: string) => {
      failuresRef.current += 1;
      logEvent("WARNING", "clip failed", {
        appid: current.appid,
        reason,
        field: "hls_h264",
      });
      if (failuresRef.current >= 3) {
        logEvent("ERROR", "too many clip failures, leaving screensaver", {
          failures: failuresRef.current,
        });
        Navigation.NavigateBack();
        return;
      }
      advance();
    };

    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(current.hls_url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) onError(data.type);
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = current.hls_url;
    } else {
      onError("hls-unsupported");
      return;
    }

    video.muted = !(settings?.audio ?? false);
    void video.play().catch((e) => onError(String(e)));

    // Distinct from the optimistic "playing clip" log above: this fires only
    // once the media element actually begins playback, so a clip that buffers
    // forever (logs "playing clip" but never this) is diagnosable.
    const onPlaying = () => {
      logEvent("DEBUG", "clip playback started", {
        appid: current.appid,
        durationSeconds: Number.isFinite(video.duration)
          ? Math.round(video.duration)
          : null,
        muted: video.muted,
      });
    };
    video.addEventListener("playing", onPlaying, { once: true });

    const onEnded = () => {
      failuresRef.current = 0;
      logEvent("DEBUG", "clip ended", {
        appid: current.appid,
        name: current.name,
        watchedSeconds: Math.round(video.currentTime),
      });
      advance();
    };
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("ended", onEnded);
      hls?.destroy();
    };
  }, [current, clips.length, settings]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "black", zIndex: 99999 }}
      onClick={() => Navigation.NavigateBack()}
    >
      <video
        ref={videoRef}
        poster={current?.thumbnail ?? undefined}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
        playsInline
      />
      {current && (
        <div
          style={{
            position: "absolute",
            left: 40,
            bottom: 40,
            color: "white",
            textShadow: "0 2px 10px rgba(0,0,0,0.95)",
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          {current.name}
        </div>
      )}
      {!loading && clips.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#aaa",
            fontSize: 26,
          }}
        >
          No trailers available right now.
        </div>
      )}
    </div>
  );
}
