import { useEffect, useState } from "react";
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
import { getSettings, setSettings } from "../lib/backend";
import type { Settings, TrailerSource, KeepAwakeStrategy } from "../lib/types";
import { setPendingSettingsTab } from "../lib/settingsNav";

const ROUTE = "/trailer-tv";
const SETTINGS_ROUTE = "/trailer-tv-settings";

const SOURCE_OPTIONS: { data: TrailerSource; label: string }[] = [
  { data: "latest", label: "Latest" },
  { data: "popular", label: "Popular" },
  { data: "trending", label: "Trending" },
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

  useEffect(() => {
    void getSettings().then(setLocal);
  }, []);

  const update = async (partial: Partial<Settings>) => {
    const next = await setSettings(partial);
    setLocal(next);
    window.__TRAILER_TV_RELOAD__?.();
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
      {/* Manual trigger: launches the player so you can watch the loaded trailers. */}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => Navigation.Navigate(ROUTE)}>
          Play now
        </ButtonItem>
      </PanelSectionRow>
      {/* Jumps straight to the Trailer Playlist tab in Settings. */}
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => {
            setPendingSettingsTab("playlist");
            Navigation.Navigate(SETTINGS_ROUTE);
          }}
        >
          View playlist
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => {
            setPendingSettingsTab("settings");
            Navigation.Navigate(SETTINGS_ROUTE);
          }}
        >
          Settings
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
          this lets gamepad nav reach the end and reveals the debug stats above.
          Tall (220px) so touchscreen drag-scroll can bottom out well BELOW the
          countdown/last-fired lines instead of cutting them off. */}
      <Focusable style={{ height: 220 }}>
        <div style={{ height: 220 }} />
      </Focusable>
    </PanelSection>
  );
}
