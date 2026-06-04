import { Focusable } from "@decky/ui";
import type { ReactNode } from "react";

// Shared internals for the Trailer Playlist and Trailer History tabs. Both are
// the same thing structurally -- a scrollable, focusable list of trailers with a
// header and an optional top-right action -- they just differ in what each row
// shows (ordered index + thumbnail for the upcoming playlist, a Store button for
// history) and where the data comes from.

export interface TrailerListItem {
  key: string;
  name: string;
  index?: number; // ordered position, rendered when present
  thumbnail?: string | null; // rendered (or a placeholder) when the field is set
  trailing?: ReactNode; // e.g. a Store button
}

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "6px 4px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const NAME: React.CSSProperties = {
  fontSize: 13,
  color: "#c8dcea",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const DIM: React.CSSProperties = { fontSize: 12, color: "#888", padding: "8px 4px" };

export function TrailerListView({
  title,
  action,
  subheader,
  items,
  emptyText,
  loading,
}: {
  title: ReactNode;
  /** Controls rendered at the top-right of the header row. */
  action?: ReactNode;
  /** Full-width row rendered below the header, e.g. a source dropdown. */
  subheader?: ReactNode;
  items: TrailerListItem[];
  emptyText: string;
  loading?: boolean;
}) {
  return (
    <Focusable style={{ display: "flex", flexDirection: "column", padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: subheader ? 6 : 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e8f4ff" }}>{title}</div>
        {action}
      </div>
      {subheader && <div style={{ marginBottom: 10 }}>{subheader}</div>}

      {loading ? (
        <div style={DIM}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={DIM}>{emptyText}</div>
      ) : (
        items.map((it) => (
          <Focusable key={it.key} style={ROW}>
            {it.index != null && (
              <span style={{ fontSize: 12, color: "#6d8799", width: 28, flexShrink: 0, textAlign: "right" }}>
                {it.index}
              </span>
            )}
            {it.thumbnail !== undefined &&
              (it.thumbnail ? (
                <img
                  src={it.thumbnail}
                  alt=""
                  style={{ width: 64, height: 36, objectFit: "cover", borderRadius: 3, flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 64, height: 36, background: "rgba(255,255,255,0.05)", borderRadius: 3, flexShrink: 0 }} />
              ))}
            <span style={NAME}>{it.name}</span>
            {it.trailing}
          </Focusable>
        ))
      )}

      {/* Focusable bottom spacer: the list only scrolls to focusable elements, so
          a plain spacer never gets revealed and the last row stays stuck under the
          Steam BPM footer. Giving gamepad nav a real target below the last row
          forces the scroll so the end of the list clears the footer. Matches the
          QAM panel's spacer. */}
      <Focusable style={{ height: 120, flexShrink: 0 }}>
        <div style={{ height: 120 }} />
      </Focusable>
    </Focusable>
  );
}
