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

const logEventBackend = callable<[level: string, message: string, context?: object], void>("log_event");

/** Fire-and-forget structured log relayed to the Python logger. */
export function logEvent(
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR",
  message: string,
  context?: object,
): void {
  void logEventBackend(level, message, context);
}
