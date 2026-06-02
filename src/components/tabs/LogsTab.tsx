import { useEffect, useState } from "react";
import { Focusable, DialogButton, showModal } from "@decky/ui";
import { getLogContents, logEvent } from "../../lib/backend";
import { LogViewerModal } from "../LogViewerModal";

export function LogsTab() {
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = () =>
    void getLogContents()
      .then((text) => {
        setLogs(text);
        setLoading(false);
      })
      .catch((e) => {
        logEvent("WARNING", "logs tab: fetch failed", { error: String(e) });
        setLoading(false);
      });

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, []);

  const lines = logs.split("\n").filter(Boolean);
  const entryCount = lines.length;
  // Only the last few lines inline; the full log lives in the scrollable modal
  // so long lines never flow off the tab page.
  const preview = lines.slice(-6).join("\n");

  const openViewer = () => {
    showModal(<LogViewerModal logs={logs} entryCount={entryCount} />);
    logEvent("DEBUG", "logs tab: opened viewer", { entryCount });
  };

  return (
    <Focusable style={{ display: "flex", flexDirection: "column", gap: 10, padding: 8, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "#9dc4e8" }}>
          {entryCount} log {entryCount === 1 ? "line" : "lines"}
        </div>
        <div style={{ fontSize: 11, color: "#6d8799" }}>Refreshes every 4s</div>
      </div>

      <Focusable style={{ display: "flex", gap: 8 }} flow-children="horizontal">
        <DialogButton onClick={openViewer} style={{ flex: 1 }}>
          Open full log viewer
        </DialogButton>
        <DialogButton onClick={refresh} style={{ width: 150, minWidth: 150, flexShrink: 0 }}>
          Refresh now
        </DialogButton>
      </Focusable>

      <div
        style={{
          background: "rgba(0,0,0,0.35)",
          borderRadius: 6,
          padding: 10,
          fontSize: 10,
          fontFamily: "monospace",
          color: "#a7c0d7",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.45,
          maxHeight: 220,
          overflow: "auto",
        }}
      >
        {loading ? "Loading logs..." : preview || "No logs yet."}
      </div>
    </Focusable>
  );
}
