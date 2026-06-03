import { useEffect, useRef, useState } from "react";
import { DialogButton } from "@decky/ui";
import {
  getPlaylist,
  refreshPlaylist,
  isPlaylistBuilding,
  logEvent,
} from "../../lib/backend";
import type { TrailerClip } from "../../lib/types";
import { openStorePage } from "../../lib/steamStore";
import { TrailerListView } from "./TrailerListView";

export function PlaylistTab() {
  const [clips, setClips] = useState<TrailerClip[]>([]);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<number | null>(null);

  // Poll continuously while the tab is mounted so the list updates live whether
  // the build was started here OR from the QAM "Refresh trailers" button. The
  // previous version only polled inside handleRefresh, so a build kicked off
  // elsewhere left the tab stuck on "Loading..." until you navigated away and
  // back.
  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      void Promise.all([getPlaylist(false), isPlaylistBuilding()]).then(([pl, b]) => {
        if (cancelled) return;
        setClips(pl);
        setBuilding(b);
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

  return (
    <TrailerListView
      title={
        building
          ? `Loading trailers... (${clips.length})`
          : `${clips.length} ${clips.length === 1 ? "trailer" : "trailers"} loaded`
      }
      action={
        <DialogButton
          style={{ width: 150, minWidth: 150, flexShrink: 0, fontSize: 12 }}
          disabled={building}
          onClick={() => void handleRefresh()}
        >
          {building ? "Refreshing..." : "Refresh"}
        </DialogButton>
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
