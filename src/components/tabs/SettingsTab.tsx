import { useEffect, useRef, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, DropdownItem } from "@decky/ui";
import {
  checkForUpdate,
  applyUpdate,
  getUpdateStatus,
  cancelUpdate,
  getSettings,
  setSettings,
  logEvent,
} from "../../lib/backend";
import type { UpdateCheckResult, UpdateStatus } from "../../lib/backend";
import type { UpdateChannel } from "../../lib/types";
import { formatVersion } from "../../lib/formatVersion";
import { triggerReload } from "../../lib/updateReload";
import { showReleaseNotesModal } from "../ReleaseNotesModal";

const PLUGIN_NAME = "decky-trailer-tv";

const CHANNEL_OPTIONS = [
  { data: "release", label: "Release" },
  { data: "pre-release", label: "Pre-release" },
  { data: "developer", label: "Developer (rolling)" },
];

type Channel = UpdateChannel;

export function SettingsTab() {
  const [channel, setChannel] = useState<Channel>("release");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [reloading, setReloading] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Load the persisted channel so it survives reopening the page.
  useEffect(() => {
    void getSettings().then((s) => {
      if (s.updateChannel) setChannel(s.updateChannel);
    });
  }, []);

  const selectChannel = (next: Channel) => {
    setChannel(next);
    setCheckResult(null);
    void setSettings({ updateChannel: next });
    logEvent("INFO", "update channel changed", { channel: next });
  };

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
          // Auto-reload on success so the user doesn't have to manually restart
          // Decky (matches decky-proton-pulse). Backend has the 'root' flag, so
          // restarting plugin_loader picks up the new files.
          if (s.state === "success") {
            setReloading(true);
            void triggerReload(PLUGIN_NAME);
          }
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

  // Seed the release-notes carousel with the pending release after a check;
  // otherwise load channel history.
  const openReleaseNotes = () => {
    if (checkResult?.success && checkResult.has_update && checkResult.release_notes) {
      showReleaseNotesModal({
        channel,
        initial: {
          version: checkResult.latest_version ?? "",
          body: checkResult.release_notes ?? "",
          releaseUrl: checkResult.release_url,
          publishedAt: checkResult.published_at,
          isPrerelease: channel === "pre-release",
          isDeveloper: channel === "developer",
        },
      });
    } else {
      showReleaseNotesModal({ channel });
    }
    logEvent("INFO", "release notes opened", { channel, seeded: !!checkResult?.has_update });
  };

  const progressPct =
    status?.progress_fraction != null ? Math.round(status.progress_fraction * 100) : null;

  return (
    <PanelSection title="Updates">
      <PanelSectionRow>
        <DropdownItem
          label="Channel"
          rgOptions={CHANNEL_OPTIONS.map((o) => ({ data: o.data, label: o.label }))}
          selectedOption={channel}
          onChange={(o) => selectChannel(o.data as Channel)}
        />
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem layout="below" disabled={checking || installing} onClick={() => void handleCheck()}>
          {checking ? "Checking..." : "Check for updates"}
        </ButtonItem>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem layout="below" disabled={installing} onClick={openReleaseNotes}>
          View release notes
        </ButtonItem>
      </PanelSectionRow>

      {checkResult && !installing && (
        <>
          {checkResult.success && checkResult.has_update ? (
            <>
              <PanelSectionRow>
                <div style={{ fontSize: 12, color: "#8dbf40" }}>
                  {formatVersion(checkResult.latest_version)} available
                </div>
              </PanelSectionRow>
              <PanelSectionRow>
                <ButtonItem layout="below" onClick={() => void handleInstall()}>
                  Install {formatVersion(checkResult.latest_version)}
                </ButtonItem>
              </PanelSectionRow>
            </>
          ) : checkResult.success ? (
            <PanelSectionRow>
              <div style={{ fontSize: 12, color: "#888" }}>
                Up to date ({formatVersion(checkResult.current_version)})
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
            {reloading
              ? `${formatVersion(status.version)} installed. Reloading the plugin...`
              : `${formatVersion(status.version)} installed.`}
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
  );
}
