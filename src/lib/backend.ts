import { callable } from "@decky/api";
import type { Settings, TrailerClip } from "./types";

export const getPlaylist = callable<[force_refresh?: boolean], TrailerClip[]>("get_playlist");
export const refreshPlaylist = callable<[], TrailerClip[]>("refresh_playlist");
export const getSettings = callable<[], Settings>("get_settings");
export const setSettings = callable<[partial: Partial<Settings>], Settings>("set_settings");

export interface DimSettings {
  battery: number | null;
  ac: number | null;
  source: string | null;
}
export const getDimSettings = callable<[], DimSettings>("get_dim_settings");

export interface Backlight {
  raw: number | null;
  max: number | null;
  ratio: number | null;
  path: string | null;
}
export const getBacklight = callable<[], Backlight>("get_backlight");

export const nudgeInput = callable<[], { ok: boolean; error?: string }>("nudge_input");
export const stopKeepAwake = callable<[], void>("stop_keep_awake");

const logEventBackend = callable<[level: string, message: string, context?: object], void>("log_event");

/** Fire-and-forget structured log relayed to the Python logger. */
export function logEvent(
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR",
  message: string,
  context?: object,
): void {
  void logEventBackend(level, message, context);
}
