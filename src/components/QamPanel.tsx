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
import { getSettings, setSettings } from "../lib/backend";
import type { Settings, TrailerSource } from "../lib/types";
import { setPendingSettingsTab } from "../lib/settingsNav";

const ROUTE = "/trailer-tv";
const SETTINGS_ROUTE = "/trailer-tv-settings";

const SOURCE_OPTIONS: { data: TrailerSource; label: string }[] = [
  { data: "latest", label: "Latest" },
  { data: "popular", label: "Popular" },
  { data: "trending", label: "Trending" },
  { data: "random", label: "Random" },
];

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
        <ButtonItem layout="below" onClick={() => window.__TRAILER_TV_START__?.() ?? Navigation.Navigate(ROUTE)}>
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
          Settings &amp; Debug
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Debug"
          description="Live state, brightness, and keep-awake options are on the Settings page."
          checked={settings.debug}
          onChange={(v) => void update({ debug: v })}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}
