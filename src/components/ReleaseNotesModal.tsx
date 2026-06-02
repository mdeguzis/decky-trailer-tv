// Release-notes browser. Follows Decky Loader's PatchNotesModal pattern: a
// Carousel of release "columns", each a translucent dark card rendering parsed
// markdown. No ModalRoot or outer frame -- the Steam BPM backdrop is the modal
// chrome. Shoulder buttons page L/R via the Carousel; B closes via the root
// Focusable's onCancelButton.
//
// Ported from decky-proton-pulse's ReleaseNotesModal, with i18n inlined to
// plain English (trailer-tv has no i18n layer) and wired to this plugin's
// logEvent + listReleases backend helpers.

import { useEffect, useState } from "react";
import {
  Carousel, Focusable, DialogButton, Navigation, showModal, findSP,
} from "@decky/ui";
import { logEvent, listReleases, type ReleaseRow } from "../lib/backend";
import { useFocusableScroll } from "../lib/useFocusableScroll";
import { formatVersion } from "../lib/formatVersion";

const TtDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

// Minimal markdown: GitHub release bodies are headings, bullet lists, and
// paragraphs. We classify each line into a block so the carousel can style
// headings/items/text without pulling in a full markdown renderer.
function parseBody(body: string): Array<{ kind: "heading" | "item" | "text"; text: string }> {
  const out: Array<{ kind: "heading" | "item" | "text"; text: string }> = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) { out.push({ kind: "text", text: buffer.trim() }); buffer = ""; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push({ kind: "heading", text: heading[1] }); continue; }
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (item) { flush(); out.push({ kind: "item", text: item[1] }); continue; }
    buffer += (buffer ? " " : "") + line.trim();
  }
  flush();
  return out;
}

// Short weekday + date + UTC time, eg. "Fri, May 30 . 14:35 UTC". We keep the
// UTC suffix so the user doesn't have to guess the timezone a release was cut in.
function formatPublishedDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
    });
    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
    });
    return `${date} . ${time} UTC`;
  } catch { return ""; }
}

function ReleaseColumn({
  release, total, idx, closeModal,
}: { release: ReleaseRow; total: number; idx: number; closeModal?: () => void }) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();
  const blocks = parseBody(release.body || "");
  const publishedLabel = formatPublishedDate(release.published_at);
  const channelLabel = release.developer
    ? "Developer"
    : release.prerelease
      ? "Pre-release"
      : "Release";
  const channelColor = release.developer
    ? "#5ec8f4"
    : release.prerelease
      ? "#f6b347"
      : "#9bb5cc";

  return (
    <Focusable
      style={{
        marginTop: "40px",
        height: "calc(100% - 40px)",
        overflowY: "scroll",
        display: "flex",
        flexDirection: "column",
        margin: "30px",
        padding: "20px 24px",
        backgroundColor: "rgba(37, 40, 46, 0.55)",
        borderRadius: 6,
      }}
    >
      {/* metadata strip */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#9bb5cc" }}>
          <span style={{
            fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
            color: "#e0ebf3",
          }}>Release Notes</span>
          {publishedLabel && (
            <>
              <span style={{ color: "#3d556a" }}>{"•"}</span>
              <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                POSTED {publishedLabel}
              </span>
            </>
          )}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700,
          color: channelColor,
          textTransform: "uppercase", letterSpacing: "0.08em",
        }}>
          {channelLabel}
          {total > 1 && (
            <span style={{ color: "#3d556a", marginLeft: 14 }}>
              {idx + 1} / {total}
            </span>
          )}
        </div>
      </div>

      {/* title */}
      <h1 style={{
        margin: "0 0 14px",
        fontSize: 28,
        fontWeight: 800,
        color: "#ffffff",
        lineHeight: 1.15,
      }}>
        {release.name || formatVersion(release.version)}
      </h1>

      {/* body blocks */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {blocks.length === 0 ? (
          <div style={{ padding: "20px 0", color: "#9bb5cc", fontSize: 14 }}>
            No release notes available for this version.
          </div>
        ) : blocks.map((b, i) => {
          const id = `b-${idx}-${i}`;
          if (b.kind === "heading") {
            return (
              <TtDialogButton key={id} onClick={() => {}}
                onFocus={onRowFocus(id)} onBlur={onRowBlur}
                style={{
                  width: "100%", textAlign: "left",
                  background: "transparent", border: "none", boxShadow: "none",
                  padding: "14px 0 4px",
                  fontSize: 17, fontWeight: 700, color: "#e8f4ff",
                  letterSpacing: "0.01em",
                  borderRight: focusBorder(id),
                }}
              >{b.text}</TtDialogButton>
            );
          }
          if (b.kind === "item") {
            return (
              <TtDialogButton key={id} onClick={() => {}}
                onFocus={onRowFocus(id)} onBlur={onRowBlur}
                style={{
                  width: "100%", textAlign: "left",
                  background: "transparent", border: "none", boxShadow: "none",
                  padding: "6px 8px 6px 22px",
                  fontSize: 14, color: "#dbe7ef", lineHeight: 1.55,
                  position: "relative",
                  borderRight: focusBorder(id),
                }}
              >
                <span style={{
                  position: "absolute", left: 6, top: 14,
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#7a9bb5",
                }} />
                {b.text}
              </TtDialogButton>
            );
          }
          return (
            <TtDialogButton key={id} onClick={() => {}}
              onFocus={onRowFocus(id)} onBlur={onRowBlur}
              style={{
                width: "100%", textAlign: "left",
                background: "transparent", border: "none", boxShadow: "none",
                padding: "6px 0",
                fontSize: 14, color: "#c8dcea", lineHeight: 1.55,
                borderRight: focusBorder(id),
              }}
            >{b.text}</TtDialogButton>
          );
        })}
      </div>

      {/* in-column footer so users don't have to scroll back up to act */}
      <Focusable style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 24,
        paddingTop: 16,
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        {release.html_url && (
          <DialogButton
            onClick={() => { try { Navigation.NavigateToExternalWeb(release.html_url); } catch { /* ignore */ } }}
            style={{ minWidth: 180, fontSize: 12 }}
          >
            Open on GitHub
          </DialogButton>
        )}
        <DialogButton onClick={closeModal} style={{ minWidth: 140, fontSize: 12 }}>
          Close
        </DialogButton>
      </Focusable>
    </Focusable>
  );
}

interface Props {
  initial?: ReleaseRow;
  // Current update channel ('release' | 'pre-release' | 'developer'); drives
  // whether the backend merges dev-tag history into the carousel.
  channel?: string;
  closeModal?: () => void;
}

function ReleaseNotesModal({ initial, channel = "release", closeModal }: Props) {
  const [releases, setReleases] = useState<ReleaseRow[] | null>(initial ? [initial] : null);
  const SP = findSP();

  useEffect(() => {
    void (async () => {
      try {
        const res = await listReleases(10, true, channel);
        if (!res?.success || !Array.isArray(res.releases)) {
          if (!initial) setReleases([]);
          return;
        }
        const fetched = res.releases;
        if (initial) {
          const rest = fetched.filter((r) => r.version !== initial.version);
          setReleases([initial, ...rest]);
        } else {
          setReleases(fetched);
        }
        logEvent("DEBUG", "ReleaseNotesModal: history loaded", {
          totalCount: fetched.length + (initial ? 1 : 0),
          channel,
        });
      } catch (e) {
        if (!initial) setReleases([]);
        logEvent("WARNING", "ReleaseNotesModal: history load failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [initial, channel]);

  // Column dims copy Decky Loader's PatchNotesModal: ~90% wide, full height
  // minus chrome.
  const itemH = SP.innerHeight - 40;
  const columnW = SP.innerWidth - SP.innerWidth * 0.1;

  if (!releases || releases.length === 0) {
    return (
      <Focusable onCancelButton={closeModal}>
        <div style={{
          margin: 30,
          padding: 40,
          backgroundColor: "rgba(37, 40, 46, 0.55)",
          borderRadius: 6,
          textAlign: "center",
          color: "#9bb5cc",
        }}>
          {releases === null ? "..." : "No release notes available for this version."}
        </div>
      </Focusable>
    );
  }

  return (
    <Focusable onCancelButton={closeModal}>
      {/* `key` forces Steam's Carousel to reset its saved column index each time
          the modal opens AND when the list grows from [initial] to full history,
          so it always starts at card 1 rather than wherever it closed. */}
      <Carousel
        key={`releases-${releases.length}`}
        fnItemRenderer={(id: number) => (
          <ReleaseColumn
            release={releases[id]}
            total={releases.length}
            idx={id}
            closeModal={closeModal}
          />
        )}
        fnGetId={(id) => id}
        nNumItems={releases.length}
        nHeight={itemH}
        nItemHeight={itemH}
        nItemMarginX={0}
        initialColumn={0}
        nIndexLeftmost={0}
        autoFocus
        fnGetColumnWidth={() => columnW}
        name="Release Notes"
      />
    </Focusable>
  );
}

export function showReleaseNotesModal(opts?: {
  initial?: {
    version: string;
    body: string;
    releaseUrl?: string;
    publishedAt?: string;
    isPrerelease?: boolean;
    isDeveloper?: boolean;
  };
  channel?: string;
}): void {
  const initial = opts?.initial;
  const seed: ReleaseRow | undefined = initial ? {
    version: initial.version,
    name: "",
    body: initial.body,
    published_at: initial.publishedAt ?? "",
    prerelease: !!initial.isPrerelease,
    developer: !!initial.isDeveloper,
    html_url: initial.releaseUrl ?? "",
  } : undefined;
  const modal = showModal(
    <ReleaseNotesModal
      initial={seed}
      channel={opts?.channel ?? "release"}
      closeModal={() => modal?.Close()}
    />,
  );
}
