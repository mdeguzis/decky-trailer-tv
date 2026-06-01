import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Navigation } from "@decky/ui";
import { getPlaylist, getSettings, logEvent } from "../lib/backend";
import type { Settings, TrailerClip } from "../lib/types";

/** Advance a playlist cursor, wrapping at the end. Empty playlist -> 0. */
function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0;
  return (current + 1) % length;
}

export function TrailerPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [clips, setClips] = useState<TrailerClip[]>([]);
  const [index, setIndex] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const failuresRef = useRef(0);

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
