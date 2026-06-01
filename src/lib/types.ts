export type TrailerSource = "latest" | "popular" | "random";

export interface TrailerClip {
  appid: number;
  name: string;
  hls_url: string;
  thumbnail: string | null;
}

export interface Settings {
  source: TrailerSource;
  audio: boolean;
  idleSeconds: number;
}
