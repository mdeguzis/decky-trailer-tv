// Shared scrollable focus hook for Decky plugin surfaces.
//
// Decky surfaces don't get scrolled by D-pad input automatically. Steam scrolls
// the focused child into view only when it is OFF-screen, so early D-pad pushes
// feel "dead". Calling scrollIntoView() on every focus change makes the page
// scroll as the focus indicator moves. Used by the release-notes carousel.

import { useState, useCallback } from "react";
import type React from "react";

export interface FocusableScrollOptions {
  // Where to keep the focused row. 'center' shows context above and below;
  // 'nearest' is Steam's laggy default.
  block?: ScrollLogicalPosition;
  // 'auto' = instant jump (snappiest on the Deck). 'smooth' can lag behind
  // input because the compositor queues the animation.
  behavior?: ScrollBehavior;
}

export interface FocusableScrollApi {
  focusedRow: string | null;
  onRowFocus: (id: string) => (e: React.FocusEvent<HTMLElement>) => void;
  onRowBlur: () => void;
  focusBorder: (id: string) => string;
}

// Single source of truth for the focus-indicator color.
const FOCUS_BORDER_COLOR = "#1a9fff";

export function useFocusableScroll(opts: FocusableScrollOptions = {}): FocusableScrollApi {
  const { block = "center", behavior = "auto" } = opts;
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  const onRowFocus = useCallback(
    (id: string) => (e: React.FocusEvent<HTMLElement>) => {
      setFocusedRow(id);
      e.currentTarget.scrollIntoView({ block, behavior });
    },
    [block, behavior],
  );

  const onRowBlur = useCallback(() => setFocusedRow(null), []);

  const focusBorder = useCallback(
    (id: string) =>
      focusedRow === id ? `3px solid ${FOCUS_BORDER_COLOR}` : "3px solid transparent",
    [focusedRow],
  );

  return { focusedRow, onRowFocus, onRowBlur, focusBorder };
}
