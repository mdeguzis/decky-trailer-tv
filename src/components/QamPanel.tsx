import { useEffect, useRef, useState } from "react";
import {
  Navigation,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  DropdownItem,
  SliderField,
  Focusable,
} from "@decky/ui";
import {
  getSettings, setSettings, refreshPlaylist,
  isPlaylistBuilding, getPlaylistCount, logEvent,
} from "../lib/backend";
import type { Settings, TrailerSource, KeepAwakeStrategy } from "../lib/types";

const ROUTE = "/trailer-tv";
const SETTINGS_ROUTE = "/trailer-tv-settings";

const SOURCE_OPTIONS: { data: TrailerSource; label: string }[] = [
  { data: "latest", label: "Latest" },
  { data: "popular", label: "Popular" },
  { data: "random", label: "Random" },
];

type Status = NonNullable<ReturnType<NonNullable<typeof window.__TRAILER_TV_STATUS__>>>;

function formatLastFired(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  const utc = d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  return `${utc} (${d.toLocaleTimeString()})`;
}

/** Live status panel, shown only when debug is enabled. Polls the watcher. */
function DebugStats() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const tick = () => setStatus(window.__TRAILER_TV_STATUS__?.() ?? null);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!status) {
    return <div style={{ fontSize: 12, color: "#888" }}>status unavailable</div>;
  }
  const state = !status.enabled
    ? "disabled (paused)"
    : status.active
      ? "ACTIVE (playing)"
      : status.gameRunning
        ? "suppressed (game running)"
        : "idle-watching";
  const countdown = !status.enabled
    ? "paused"
    : status.active
      ? "-"
      : `${status.secondsUntil}s`;
  return (
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.5,
        color: "#ccc",
        fontFamily: "monospace",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        maxWidth: "100%",
        boxSizing: "border-box",
        paddingRight: 8,
      }}
    >
      <div>state: {state}</div>
      <div>
        countdown: {countdown} / {status.triggerSeconds}s ({status.basis})
      </div>
      <div>last fired:</div>
      <div>{formatLastFired(status.lastFiredAt)}</div>
    </div>
  );
}

export function QamPanel() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [refreshDone, setRefreshDone] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void getSettings().then(setLocal);
  }, []);

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const update = async (partial: Partial<Settings>) => {
    const next = await setSettings(partial);
    setLocal(next);
    window.__TRAILER_TV_RELOAD__?.();
  };

  const refresh = async () => {
    stopPoll();
    setRefreshing(true);
    setRefreshDone(false);
    setLiveCount(null);
    logEvent("INFO", "qam: refresh trailers clicked", {});
    await refreshPlaylist();

    // Poll until the background build finishes, updating the live count each tick.
    pollRef.current = window.setInterval(() => {
      void Promise.all([isPlaylistBuilding(), getPlaylistCount()]).then(([building, n]) => {
        setLiveCount(n);
        if (!building) {
          stopPoll();
          setRefreshing(false);
          setRefreshDone(true);
          logEvent("INFO", "qam: refresh complete", { count: n });
          // Clear the success state after 4s so the button returns to normal.
          window.setTimeout(() => setRefreshDone(false), 4000);
        }
      });
    }, 1500);
  };

  if (!settings) {
    return <PanelSection title="Trailer TV">Loading...</PanelSection>;
  }

  return (
    <PanelSection title="Trailer TV">
      <PanelSectionRow>
        <ToggleField
          label="Enabled"
          description="Turn off to pause the screensaver (take a break)."
          checked={settings.enabled}
          onChange={(v) => void update({ enabled: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
          label="Trailers"
          rgOptions={SOURCE_OPTIONS.map((o) => ({ data: o.data, label: o.label }))}
          selectedOption={settings.source}
          onChange={(o) => void update({ source: o.data as TrailerSource })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Play audio"
          checked={settings.audio}
          onChange={(v) => void update({ audio: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <SliderField
          label="Start after idle"
          description={
            settings.customIdleSeconds === 0
              ? "0 = follow Steam's dim time. Set below your Steam dim so it fires first."
              : `Starts after ${settings.customIdleSeconds}s idle (overrides Steam).`
          }
          value={settings.customIdleSeconds}
          min={0}
          max={600}
          step={15}
          showValue
          onChange={(v) => void update({ customIdleSeconds: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing
            ? `Refreshing...${liveCount !== null && liveCount > 0 ? ` (${liveCount})` : ""}`
            : refreshDone
              ? `Loaded ${liveCount ?? 0} trailers`
              : "Refresh trailers"}
        </ButtonItem>
      </PanelSectionRow>
      {/* Manual trigger pinned at the end of the list. */}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => Navigation.Navigate(ROUTE)}>
          Test
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => Navigation.Navigate(SETTINGS_ROUTE)}>
          View Playlist / Updates
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Debug"
          description="Show live state, countdown, and last-fired time."
          checked={settings.debug}
          onChange={(v) => void update({ debug: v })}
        />
      </PanelSectionRow>
      {settings.debug && (
        <PanelSectionRow>
          <DropdownItem
            label="Keep-awake"
            rgOptions={[
              { data: "settings", label: "settings (dim timeout)" },
              { data: "uinput", label: "uinput (real input)" },
              { data: "brightness", label: "brightness write-back" },
              { data: "off", label: "off (audit only)" },
            ]}
            selectedOption={settings.keepAwakeStrategy}
            onChange={(o) => void update({ keepAwakeStrategy: o.data as KeepAwakeStrategy })}
          />
        </PanelSectionRow>
      )}
      {settings.debug && (
        <PanelSectionRow>
          <DebugStats />
        </PanelSectionRow>
      )}
      {/* Focusable bottom spacer: the QAM only scrolls to focusable elements, so
          this lets gamepad nav reach the end and reveals the debug stats above. */}
      <Focusable style={{ height: 96 }}>
        <div style={{ height: 96 }} />
      </Focusable>
    </PanelSection>
  );
}
