import { useEffect, useState } from "react";
import { Focusable } from "@decky/ui";
import { getPluginVersion } from "../../lib/backend";
import { formatVersion } from "../../lib/formatVersion";

const GITHUB = "https://github.com/mdeguzis/decky-trailer-tv";
const LINKS = [
  { label: "GitHub", url: GITHUB },
  { label: "Report an issue", url: `${GITHUB}/issues/new` },
];

export function AboutTab() {
  const [version, setVersion] = useState("...");

  useEffect(() => {
    void getPluginVersion().then(setVersion).catch(() => setVersion("..."));
  }, []);

  return (
    <Focusable style={{ padding: 12, fontSize: 12, color: "#ccc", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>Trailer TV</div>
      <div style={{ color: "#888", fontSize: 12, margin: "2px 0 12px" }}>{formatVersion(version)}</div>

      <div style={{ marginBottom: 16, lineHeight: 1.5, maxWidth: 640 }}>
        When your Steam Deck goes idle (docked or charging), Trailer TV plays
        random featured Steam store trailers instead of a blank screen. It revives
        the old SteamOS Trailer TV screensaver. Any input dismisses it.
      </div>

      <Focusable style={{ display: "flex", gap: 12, flexWrap: "wrap" }} flow-children="horizontal">
        {LINKS.map(({ label, url }) => (
          <Focusable
            key={url}
            onActivate={() => { try { window.open(url, "_blank"); } catch { /* noop */ } }}
            style={{
              color: "#4c9eff",
              padding: "4px 8px",
              borderRadius: 3,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {label} {"↗"}
          </Focusable>
        ))}
      </Focusable>

      <div style={{ height: 80, flexShrink: 0 }} aria-hidden="true" />
    </Focusable>
  );
}
