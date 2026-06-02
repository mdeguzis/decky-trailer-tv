import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Navigation } from "@decky/ui";
import { getPlaylist, getSettings, getBacklight, logEvent } from "../lib/backend";
import { startControllerActivity } from "../lib/steamPower";
import type { Settings, TrailerClip } from "../lib/types";

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

  // Exit on ANY input, like a real idle/sleep screensaver -- regardless of how
  // it was launched (idle trigger or the QAM "Test" button). Notifies the idle
  // watcher on unmount so it re-arms from now.
  useEffect(() => {
    const armAt = Date.now() + INPUT_GRACE_MS;
    let exited = false;

    const exit = (source: string) => {
      if (exited || Date.now() < armAt) return;
      exited = true;
      logEvent("INFO", "screensaver exited by input", { source });
      Navigation.NavigateBack();
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

  // AUDIT: poll the REAL hardware backlight (sysfs) to detect the idle dim --
  // RegisterForBrightnessChanges is blind to it. A drop from the baseline while
  // Trailer TV is on screen means SteamOS dimmed under us (issue #1).
  useEffect(() => {
    logEvent("INFO", "Trailer TV active -- backlight dim audit started", {});
    let baseline: number | null = null;
    let dimLogged = false;
    let cancelled = false;

    const poll = async () => {
      const bl = await getBacklight();
      if (cancelled || bl.raw === null) return;
      if (baseline === null || bl.raw > baseline) {
        baseline = bl.raw;
        logEvent("INFO", "backlight baseline during Trailer TV", { raw: bl.raw, ratio: bl.ratio });
        dimLogged = false;
        return;
      }
      if (bl.raw < baseline * 0.9 && !dimLogged) {
        dimLogged = true;
        logEvent("WARNING", "DIM during Trailer TV (backlight dropped)", {
          fromRaw: baseline,
          toRaw: bl.raw,
          ratio: bl.ratio,
          path: bl.path,
        });
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      logEvent("INFO", "Trailer TV closed -- backlight dim audit stopped", {});
    };
  }, []);

  // Load playlist + settings once on mount.
  useEffect(() => {
    void (async () => {
      try {
        const [pl, s] = await Promise.all([getPlaylist(false), getSettings()]);
        setSettings(s);
        setClips(pl);
        logEvent("INFO", "TrailerPlayer mounted", {
          source: s.source,
          count: pl.length,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = clips[index];

  // Attach hls.js whenever the current clip changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;

    let hls: Hls | null = null;
    const advance = () => setIndex((i) => nextIndex(i, clips.length));

    logEvent("DEBUG", "playing clip", {
      appid: current.appid,
      name: current.name,
      index,
      total: clips.length,
      engine: Hls.isSupported() ? "hls.js" : "native",
    });

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

    const onEnded = () => {
      failuresRef.current = 0;
      advance();
    };
    video.addEventListener("ended", onEnded);

    return () => {
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
