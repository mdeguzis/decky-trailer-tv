import { useEffect, useState } from "react";
import {
  Navigation,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  DropdownItem,
} from "@decky/ui";
import { getSettings, setSettings, refreshPlaylist } from "../lib/backend";
import type { Settings, TrailerSource } from "../lib/types";

const ROUTE = "/trailer-tv";

const SOURCE_OPTIONS: { data: TrailerSource; label: string }[] = [
  { data: "latest", label: "Latest" },
  { data: "popular", label: "Popular" },
  { data: "random", label: "Random" },
];

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
    </PanelSection>
  );
}
