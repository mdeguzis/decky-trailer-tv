import { useEffect, useState } from "react";
import {
  Navigation,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  DropdownItem,
  SliderField,
} from "@decky/ui";
import { getSettings, setSettings, refreshPlaylist } from "../lib/backend";
import type { Settings, TrailerSource } from "../lib/types";

const ROUTE = "/trailer-tv";

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
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, color: "#ccc", fontFamily: "monospace" }}>
      <div>state: {state}</div>
      <div>
        countdown: {status.active ? "-" : `${status.secondsUntil}s`} / {status.triggerSeconds}s
        ({status.basis})
      </div>
      <div>last fired: {formatLastFired(status.lastFiredAt)}</div>
    </div>
  );
}

export function QamPanel() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void getSettings().then(setLocal);
  }, []);

  const update = async (partial: Partial<Settings>) => {
    const next = await setSettings(partial);
    setLocal(next);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const pl = await refreshPlaylist();
      setCount(pl.length);
    } finally {
      setRefreshing(false);
    }
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
        <ButtonItem layout="below" disabled={refreshing} onClick={refresh}>
          {refreshing
            ? "Refreshing..."
            : `Refresh trailers${count !== null ? ` (${count})` : ""}`}
        </ButtonItem>
      </PanelSectionRow>
      {/* Manual trigger pinned at the end of the list. */}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => Navigation.Navigate(ROUTE)}>
          Test
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
          <DebugStats />
        </PanelSectionRow>
      )}
      {/* Bottom padding so the last row isn't clipped by the QAM. */}
      <div style={{ height: 24 }} />
    </PanelSection>
  );
}
