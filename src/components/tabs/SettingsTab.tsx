import { useEffect, useRef, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, DropdownItem } from "@decky/ui";
import {
  checkForUpdate,
  applyUpdate,
  getUpdateStatus,
  cancelUpdate,
  getSettings,
  setSettings,
  getPluginVersion,
  getBuildCommit,
  logEvent,
} from "../../lib/backend";
import type { UpdateCheckResult, UpdateStatus } from "../../lib/backend";
import type { UpdateChannel } from "../../lib/types";
import { formatVersion } from "../../lib/formatVersion";
import { triggerReload } from "../../lib/updateReload";
import { showReleaseNotesModal } from "../ReleaseNotesModal";
import { DebugSection } from "../DebugSection";

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
  const [version, setVersion] = useState("...");
  const [buildCommit, setBuildCommit] = useState("");
  const pollRef = useRef<number | null>(null);

  // Load the persisted channel so it survives reopening the page.
  useEffect(() => {
    void getSettings().then((s) => {
      if (s.updateChannel) setChannel(s.updateChannel);
    });
    void getPluginVersion().then(setVersion).catch(() => {});
    void getBuildCommit().then(setBuildCommit).catch(() => {});
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
          // Don't auto-reload. The new files are staged; let the user restart on
          // their own time via the "Restart plugin" button (matches
          // decky-proton-pulse). Restarting mid-playback would be jarring.
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

  // Restart the plugin to apply a staged update, triggered by the user on their
  // own time. Mirrors decky-proton-pulse: install stages the files, the user
  // restarts when ready. If reload/restart succeeds the page goes away on its own.
  const handleRestartPlugin = async () => {
    setReloading(true);
    const outcome = await triggerReload(PLUGIN_NAME);
    logEvent("INFO", "restart plugin requested", { outcome });
    if (outcome === "failed") {
      setReloading(false);
    }
  };

  const updateApplied = status?.state === "success";

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

  // The developer channel always reports has_update=true (rolling tag). Compare
  // the commit embedded in the dev label ("Developer build (<sha>)") against the
  // locally installed .build-commit so we don't offer to reinstall the same
  // build. Matches decky-proton-pulse.
  const sameDevBuildAsLocal = (() => {
    if (!checkResult?.success || channel !== "developer") return false;
    const m = /\(([0-9a-f]{6,40})(?:\+uncommitted)?\)/i.exec(checkResult.latest_version ?? "");
    if (!m) return false;
    const localSha = (buildCommit || "").split("+")[0].toLowerCase();
    return localSha !== "" && localSha === m[1].toLowerCase();
  })();
  const hasUpdate = !!checkResult?.has_update && !sameDevBuildAsLocal;

  return (
    <>
    <PanelSection title="Updates">
      <PanelSectionRow>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
          <span style={{ fontSize: 12, color: "#9dc4e8" }}>Installed</span>
          <span style={{ fontSize: 11, color: "#7a9bb5", fontFamily: "monospace", textAlign: "right" }}>
            {formatVersion(version)}
            {buildCommit && <span style={{ color: "#5a7a8f" }}>{"  "}@{buildCommit}</span>}
          </span>
        </div>
      </PanelSectionRow>

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
          {checkResult.success && hasUpdate ? (
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
                {sameDevBuildAsLocal
                  ? `Up to date (${checkResult.latest_version})`
                  : `Up to date (${formatVersion(checkResult.current_version)})`}
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

      {updateApplied && !installing && (
        <>
          <PanelSectionRow>
            <div style={{ fontSize: 12, color: "#8dbf40" }}>
              {formatVersion(status?.version)} installed. Restart the plugin to apply, on your own time.
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={reloading} onClick={() => void handleRestartPlugin()}>
              {reloading ? "Restarting..." : "Restart plugin"}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}

      {status?.state === "error" && !installing && (
        <PanelSectionRow>
          <div style={{ fontSize: 12, color: "#e06c75" }}>
            Update failed: {status.error}
          </div>
        </PanelSectionRow>
      )}
    </PanelSection>
    <DebugSection />
    </>
  );
}
