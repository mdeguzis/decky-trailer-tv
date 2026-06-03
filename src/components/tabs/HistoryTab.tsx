import { useEffect, useState } from "react";
import { DialogButton } from "@decky/ui";
import { getPlayedHistory, logEvent } from "../../lib/backend";
import { openStorePage } from "../../lib/steamStore";
import { TrailerListView } from "./TrailerListView";

export function HistoryTab() {
  const [history, setHistory] = useState<{ appid: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      void getPlayedHistory().then((h) => {
        setHistory(h);
        setLoading(false);
        logEvent("DEBUG", "history tab: loaded played history", { count: h.length });
      });
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <TrailerListView
      title="Played this session"
      loading={loading}
      emptyText="No trailers played yet this session."
      items={history.map((entry, i) => ({
        key: `${entry.appid}`,
        index: i + 1,
        name: entry.name,
        // Fixed-width, flexShrink:0 so the button never overflows the right edge.
        trailing: (
          <DialogButton
            style={{ width: 120, minWidth: 120, flexShrink: 0, fontSize: 12 }}
            onClick={() => {
              openStorePage(entry.appid);
              logEvent("DEBUG", "history tab: open store page", { appid: entry.appid });
            }}
          >
            Store
          </DialogButton>
        ),
      }))}
    />
  );
}
