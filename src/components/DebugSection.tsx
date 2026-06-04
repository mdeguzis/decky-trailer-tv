import { useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, ToggleField, DropdownItem, DialogButton } from "@decky/ui";
import { getSettings, setSettings, getLockScreenSettings, getBacklight } from "../lib/backend";
import { startBrightnessAudit } from "../lib/steamPower";
import type { Settings, KeepAwakeStrategy } from "../lib/types";

// DialogButton typed to accept a DOM focus event so onFocus can scroll the row
// into view (the proven Decky scroll pattern -- a plain Focusable never scrolls).
const FocusButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & { onFocus?: (e: React.FocusEvent<HTMLElement>) => void }
>;

type Status = NonNullable<ReturnType<NonNullable<typeof window.__TRAILER_TV_STATUS__>>>;

const KEEP_AWAKE_OPTIONS = [
  { data: "settings", label: "settings (dim timeout)" },
  { data: "uinput", label: "uinput (real input)" },
  { data: "brightness", label: "brightness write-back" },
  { data: "off", label: "off (audit only)" },
];

function formatLastFired(ms: number | null): string {
  if (!ms) return "never";
  return new Date(ms).toLocaleTimeString();
}

/** Live debug panel: toggle, keep-awake strategy, and live state/brightness. Used
 * on the Settings page so the QAM stays short (no scroll cutoff). */
export function DebugSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [backlightRatio, setBacklightRatio] = useState<number | null>(null);

  useEffect(() => {
    void getSettings().then(setLocal);
    void getLockScreenSettings().then((s) => setHasPin(s.has_pin));
  }, []);

  const debug = settings?.debug ?? false;
  useEffect(() => {
    if (!debug) return;
    const tick = () => {
      setStatus(window.__TRAILER_TV_STATUS__?.() ?? null);
      void getBacklight().then((b) => setBacklightRatio(b.ratio));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    const stopBrightness = startBrightnessAudit((d) => {
      if (typeof d?.flBrightness === "number") setBrightness(d.flBrightness);
    });
    return () => {
      window.clearInterval(id);
      stopBrightness();
    };
  }, [debug]);

  const update = async (partial: Partial<Settings>) => {
    const next = await setSettings(partial);
    setLocal(next);
    window.__TRAILER_TV_RELOAD__?.();
  };

  if (!settings) return null;

  const state = !status
    ? "unavailable"
    : !status.enabled
      ? "disabled (paused)"
      : status.active
        ? "ACTIVE (playing)"
        : status.gameRunning
          ? "suppressed (game running)"
          : "idle-watching";
  const countdown = !status || !status.enabled ? "-" : status.active ? "-" : `${status.secondsUntil}s`;
  const pct = (v: number | null) => (v == null ? "?" : `${Math.round(v * 100)}%`);

  return (
    <PanelSection title="Debug">
      <PanelSectionRow>
        <ToggleField
          label="Debug"
          description="Show live state, brightness, and the keep-awake strategy selector."
          checked={settings.debug}
          onChange={(v) => void update({ debug: v })}
        />
      </PanelSectionRow>
      {settings.debug && (
        <>
          <PanelSectionRow>
            <DropdownItem
              label="Keep-awake"
              rgOptions={KEEP_AWAKE_OPTIONS.map((o) => ({ data: o.data, label: o.label }))}
              selectedOption={settings.keepAwakeStrategy}
              onChange={(o) => void update({ keepAwakeStrategy: o.data as KeepAwakeStrategy })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            {/* Focusable button (not a plain div) that scrolls itself to center on
                focus -- the only thing that reliably scrolls a SidebarNavigation
                page. Styled flat so it reads as a text block. */}
            <FocusButton
              onClick={() => {}}
              onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
              style={{
                width: "100%",
                textAlign: "left",
                display: "block",
                background: "transparent",
                border: "none",
                boxShadow: "none",
                padding: "6px 0",
                fontSize: 12,
                lineHeight: 1.6,
                color: "#cdd9e5",
                fontFamily: "monospace",
              }}
            >
              <div>state: {state}</div>
              <div>
                countdown: {countdown}
                {status ? ` / ${status.triggerSeconds}s (${status.basis})` : ""}
              </div>
              <div>brightness: {pct(brightness)}</div>
              <div>backlight: {pct(backlightRatio)}</div>
              <div>last fired: {formatLastFired(status?.lastFiredAt ?? null)}</div>
              <div>lock on exit: {hasPin === null ? "..." : hasPin ? "yes (PIN set)" : "no"}</div>
            </FocusButton>
          </PanelSectionRow>
          {/* Focusable end marker: D-pad down lands here and scrolls the bottom
              into view (a plain spacer is not a focus target, so nav can't reach
              past the stats). Pairs with the trailing clearance div. */}
          <PanelSectionRow>
            <FocusButton
              onClick={() => {}}
              onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
              style={{
                width: "100%",
                textAlign: "center",
                background: "transparent",
                border: "none",
                boxShadow: "none",
                padding: "6px 0",
                fontSize: 10,
                color: "#4a6070",
              }}
            >
              end of debug info
            </FocusButton>
          </PanelSectionRow>
          {/* Clearance so the focused end marker can scroll above the ~64px footer. */}
          <div style={{ height: 90, flexShrink: 0 }} aria-hidden="true" />
        </>
      )}
    </PanelSection>
  );
}
