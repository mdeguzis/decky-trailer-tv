import { Navigation } from "@decky/ui";

const STORE_WEB_URL = (appid: number) => `https://store.steampowered.com/app/${appid}`;

// Open the Steam store to a specific app. In Game Mode, NavigateToExternalWeb
// hands off to a system browser that often does nothing on the Deck; the native
// store deep link (steam://store/<appid>) opens the in-client store page, and
// NavigateToSteamWeb (the in-Steam browser) is the typed fallback.
export function openStorePage(appid: number): void {
  try {
    const exec = (window as any).SteamClient?.URL?.ExecuteSteamURL;
    if (typeof exec === "function") {
      exec(`steam://store/${appid}`);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    Navigation.NavigateToSteamWeb(STORE_WEB_URL(appid));
  } catch {
    try {
      Navigation.NavigateToExternalWeb(STORE_WEB_URL(appid));
    } catch {
      /* nothing else to try */
    }
  }
}
