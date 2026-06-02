import { useEffect, useRef, useState } from "react";
import { ModalRoot, Focusable, DialogButton, GamepadButton } from "@decky/ui";
import type { GamepadEvent } from "@decky/ui";

// Full-screen scrollable log viewer, ported from decky-proton-pulse. Keeps long
// log lines inside a dedicated scroll container (D-pad up/down scrolls it) so
// they don't flow off the tab page. i18n + toaster are inlined since trailer-tv
// has neither.

const SCROLL_STEP = 120;

interface Props {
  logs: string;
  entryCount: number;
  closeModal?: () => void;
}

export function LogViewerModal({ logs, entryCount, closeModal }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const initializedRef = useRef(false);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      el.scrollTop = el.scrollHeight; // start at the newest line
    }
  }, [logs]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(logs);
      } else {
        const ta = document.createElement("textarea");
        ta.value = logs;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard not available; ignore */
    }
  };

  const handleDirection = (evt: GamepadEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      evt.preventDefault();
      el.scrollBy({ top: el.scrollTop <= SCROLL_STEP ? -el.scrollTop : -SCROLL_STEP, behavior: "auto" });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      evt.preventDefault();
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      el.scrollBy({ top: remaining <= SCROLL_STEP ? remaining : SCROLL_STEP, behavior: "auto" });
    }
  };

  return (
    <ModalRoot
      onCancel={closeModal}
      bAllowFullSize
      className="trailer-tv-log-modal"
      modalClassName="trailer-tv-log-modal"
    >
      <style>{`
        .trailer-tv-log-modal,
        .trailer-tv-log-modal > div,
        .trailer-tv-log-modal .DialogContent_InnerWidth {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100vw !important;
          width: 100vw !important;
          max-height: 100vh !important;
        }
        .trailer-tv-log-modal .ModalPosition { inset: 0 !important; }
      `}</style>
      <Focusable
        onGamepadDirection={handleDirection}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 88px)",
          padding: "12px 16px 20px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f4ff", marginBottom: 4 }}>Plugin Logs</div>
            <div style={{ fontSize: 11, color: "#7a9bb5" }}>{entryCount} lines</div>
          </div>
          <Focusable
            flow-children="horizontal"
            style={{ display: "flex", gap: 8, flexShrink: 0, alignSelf: "flex-start" }}
            onGamepadDirection={handleDirection}
          >
            <DialogButton onClick={scrollToBottom} style={{ minWidth: 0, width: "auto", maxWidth: 150, padding: "4px 10px", fontSize: 11, flex: "0 0 auto" }}>
              Jump to latest
            </DialogButton>
            <DialogButton onClick={() => void handleCopy()} style={{ minWidth: 0, width: "auto", maxWidth: 130, padding: "4px 10px", fontSize: 11, flex: "0 0 auto" }}>
              {copied ? "Copied" : "Copy logs"}
            </DialogButton>
          </Focusable>
        </div>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            background: "rgba(0,0,0,0.42)",
            borderRadius: 6,
            padding: "10px 10px 24px",
            fontSize: 10,
            fontFamily: "monospace",
            color: "#bbb",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            lineHeight: 1.45,
            minHeight: 0,
          }}
        >
          {logs || <span style={{ color: "#666" }}>No logs yet.</span>}
        </div>
      </Focusable>
    </ModalRoot>
  );
}
