import { useEffect, useRef, useState } from "react";
import { DialogButton, DropdownItem } from "@decky/ui";
import {
  getPlaylist,
  refreshPlaylist,
  getBuildStatus,
  getSettings,
  setSettings,
  logEvent,
} from "../../lib/backend";
import type { TrailerClip, TrailerSource } from "../../lib/types";
import { openStorePage } from "../../lib/steamStore";
import { TrailerListView } from "./TrailerListView";

const SOURCE_OPTIONS: { data: TrailerSource; label: string }[] = [
  { data: "latest", label: "Latest" },
  { data: "popular", label: "Popular" },
  { data: "trending", label: "Trending" },
  { data: "random", label: "Random" },
];

export function PlaylistTab() {
  const [clips, setClips] = useState<TrailerClip[]>([]);
  const [building, setBuilding] = useState(false);
  const [buildTotal, setBuildTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<TrailerSource>("popular");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void getSettings().then((s) => setSource(s.source ?? "popular"));
  }, []);

  // Poll continuously while the tab is mounted so the list updates live whether
  // the build was started here OR from the QAM "Refresh trailers" button. The
  // previous version only polled inside handleRefresh, so a build kicked off
  // elsewhere left the tab stuck on "Loading..." until you navigated away and
  // back.
  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      void Promise.all([getPlaylist(false), getBuildStatus()]).then(([pl, status]) => {
        if (cancelled) return;
        setClips(pl);
        setBuilding(status.building);
        setBuildTotal(status.total);
        setLoading(false);
      });
    tick();
    pollRef.current = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const handleRefresh = async () => {
    setBuilding(true);
    logEvent("INFO", "playlist tab: refresh clicked", {});
    await refreshPlaylist();
    // The mounted poll above reflects progress; no separate poll needed.
  };

  const handleSourceChange = async (newSource: TrailerSource) => {
    setSource(newSource);
    logEvent("INFO", "playlist tab: source changed", { source: newSource });
    await setSettings({ source: newSource });
    await refreshPlaylist();
  };

  return (
    <TrailerListView
      title={
        building
          ? `Loading trailers... (${clips.length}${buildTotal > 0 ? `/${buildTotal}` : ""})`
          : `${clips.length} ${clips.length === 1 ? "trailer" : "trailers"} loaded`
      }
      action={
        <DialogButton
          style={{ width: 130, minWidth: 130, flexShrink: 0, fontSize: 12 }}
          disabled={building}
          onClick={() => void handleRefresh()}
        >
          {building ? "Refreshing..." : "Refresh"}
        </DialogButton>
      }
      toolbar={
        <DropdownItem
          label="Source"
          rgOptions={SOURCE_OPTIONS.map((o) => ({ data: o.data, label: o.label }))}
          selectedOption={source}
          onChange={(o) => void handleSourceChange(o.data as TrailerSource)}
        />
      }
      loading={loading}
      emptyText="No trailers loaded yet. Press Refresh to build the playlist."
      items={clips.map((clip, i) => ({
        key: `${clip.appid}-${i}`,
        index: i + 1,
        thumbnail: clip.thumbnail,
        name: clip.name,
        trailing: (
          <DialogButton
            style={{ width: 120, minWidth: 120, flexShrink: 0, fontSize: 12 }}
            onClick={() => {
              openStorePage(clip.appid);
              logEvent("DEBUG", "playlist tab: open store page", { appid: clip.appid });
            }}
          >
            Store
          </DialogButton>
        ),
      }))}
    />
  );
}
