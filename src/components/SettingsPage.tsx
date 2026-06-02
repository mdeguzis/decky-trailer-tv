import { useEffect, useState, useRef } from "react";
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  DropdownItem,
  Focusable,
  Navigation,
} from "@decky/ui";
import {
  checkForUpdate,
  applyUpdate,
  getUpdateStatus,
  cancelUpdate,
  getPluginVersion,
  getPlayedHistory,
  logEvent,
} from "../lib/backend";
import type { UpdateCheckResult, UpdateStatus } from "../lib/backend";

const CHANNEL_OPTIONS = [
  { data: "release", label: "Release" },
  { data: "pre-release", label: "Pre-release" },
];

const STORE_URL = (appid: number) => `https://store.steampowered.com/app/${appid}`;

// ---- Played history section ----

function PlayedHistory() {
  const [history, setHistory] = useState<{ appid: number; name: string }[]>([]);

  useEffect(() => {
    const load = () =>
      void getPlayedHistory().then((h) => {
        setHistory(h);
        logEvent("DEBUG", "settings: loaded played history", { count: h.length });
      });
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, []);

  if (history.length === 0) {
    return (
      <PanelSectionRow>
        <div style={{ fontSize: 12, color: "#666" }}>
          No trailers played yet this session.
        </div>
      </PanelSectionRow>
    );
  }

  return (
    <Focusable style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {history.map((entry) => (
        <div
          key={entry.appid}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 4px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: "#c8dcea",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              paddingRight: 8,
            }}
          >
            {entry.name}
          </span>
          <ButtonItem
            layout="inline"
            onClick={() => {
              try {
                Navigation.NavigateToExternalWeb(STORE_URL(entry.appid));
              } catch {
                /* ignore */
              }
              logEvent("DEBUG", "settings: open store page", { appid: entry.appid });
            }}
            style={{ minWidth: 80, fontSize: 11, padding: "4px 8px" }}
          >
            Store
          </ButtonItem>
        </div>
      ))}
    </Focusable>
  );
}

// ---- Main settings page ----

export function SettingsPage() {
  const [version, setVersion] = useState<string>("...");
  const [channel, setChannel] = useState<"release" | "pre-release">("release");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void getPluginVersion().then(setVersion);
  }, []);

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPoll = () => {
    stopPoll();
    pollRef.current = window.setInterval(() => {
      void getUpdateStatus().then((s) => {
        setStatus(s);
        if (s.state !== "running") {
          stopPoll();
          setInstalling(false);
          logEvent("INFO", "update finished", { state: s.state, version: s.version, error: s.error });
        }
      });
    }, 1000);
  };

  useEffect(() => () => stopPoll(), []);

  const handleCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await checkForUpdate(channel);
      setCheckResult(result);
      logEvent("INFO", "check_for_update result", {
        has_update: result.has_update,
        latest: result.latest_version,
        channel,
      });
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!checkResult?.zip_url || !checkResult.latest_version) return;
    setInstalling(true);
    setStatus(null);
    const result = await applyUpdate(checkResult.zip_url, checkResult.latest_version);
    if (!result.ok) {
      setInstalling(false);
      logEvent("ERROR", "apply_update rejected", { error: result.error });
      return;
    }
    startPoll();
  };

  const handleCancel = async () => {
    await cancelUpdate();
    stopPoll();
    setInstalling(false);
  };

  const progressPct =
    status?.progress_fraction != null
      ? Math.round(status.progress_fraction * 100)
      : status?.downloaded_bytes != null && status.total_bytes
        ? Math.round((status.downloaded_bytes / status.total_bytes) * 100)
        : null;

  return (
    <div style={{ padding: "16px 0" }}>
      <PanelSection title="About">
        <PanelSectionRow>
          <div style={{ fontSize: 13, color: "#ccc" }}>
            Trailer TV &nbsp;&mdash;&nbsp; v{version}
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Played this session">
        <PlayedHistory />
      </PanelSection>

      <PanelSection title="Updates">
        <PanelSectionRow>
          <DropdownItem
            label="Channel"
            rgOptions={CHANNEL_OPTIONS.map((o) => ({ data: o.data, label: o.label }))}
            selectedOption={channel}
            onChange={(o) => {
              setChannel(o.data as "release" | "pre-release");
              setCheckResult(null);
            }}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" disabled={checking || installing} onClick={() => void handleCheck()}>
            {checking ? "Checking..." : "Check for updates"}
          </ButtonItem>
        </PanelSectionRow>

        {checkResult && !installing && (
          <>
            {checkResult.success && checkResult.has_update ? (
              <>
                <PanelSectionRow>
                  <div style={{ fontSize: 12, color: "#8dbf40" }}>
                    v{checkResult.latest_version} available
                  </div>
                </PanelSectionRow>
                <PanelSectionRow>
                  <ButtonItem layout="below" onClick={() => void handleInstall()}>
                    Install v{checkResult.latest_version}
                  </ButtonItem>
                </PanelSectionRow>
              </>
            ) : checkResult.success ? (
              <PanelSectionRow>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Up to date (v{checkResult.current_version})
                </div>
              </PanelSectionRow>
            ) : (
              <PanelSectionRow>
                <div style={{ fontSize: 12, color: "#e06c75" }}>
                  Check failed: {checkResult.error}
                </div>
              </PanelSectionRow>
            )}
          </>
        )}

        {installing && status && (
          <>
            <PanelSectionRow>
              <div style={{ fontSize: 12, color: "#ccc" }}>
                {status.stage === "downloading"
                  ? `Downloading${progressPct != null ? ` ${progressPct}%` : "..."}`
                  : status.stage === "extracting"
                    ? "Extracting..."
                    : "Working..."}
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={() => void handleCancel()}>
                Cancel
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}

        {status?.state === "success" && !installing && (
          <PanelSectionRow>
            <div style={{ fontSize: 12, color: "#8dbf40" }}>
              v{status.version} installed. Restart Decky to apply.
            </div>
          </PanelSectionRow>
        )}

        {status?.state === "error" && !installing && (
          <PanelSectionRow>
            <div style={{ fontSize: 12, color: "#e06c75" }}>
              Update failed: {status.error}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* Bottom spacer so gamepad nav can reach the last item */}
      <Focusable style={{ height: 64 }}>
        <div style={{ height: 64 }} />
      </Focusable>
    </div>
  );
}
