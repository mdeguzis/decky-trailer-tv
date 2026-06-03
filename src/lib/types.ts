export type TrailerSource = "latest" | "popular" | "trending" | "random";

export type UpdateChannel = "release" | "pre-release" | "developer";

// Keep-awake strategy to stop the OS dim/sleep during playback.
export type KeepAwakeStrategy = "off" | "brightness" | "uinput" | "settings";

export interface TrailerClip {
  appid: number;
  name: string;
  hls_url: string;
  thumbnail: string | null;
}

export interface Settings {
  enabled: boolean;
  source: TrailerSource;
  audio: boolean;
  idleSeconds: number;
  customIdleSeconds: number;
  debug: boolean;
  keepAwakeStrategy: KeepAwakeStrategy;
  updateChannel: UpdateChannel;
}
