import { restartPluginLoader } from "./backend";
import { logEvent } from "./backend";

// Reload the plugin after a successful self-update so the user doesn't have to
// manually restart Decky. Mirrors decky-proton-pulse's triggerReload:
//   1. Hot-reload via DeckyPluginLoader.reloadPlugin (no restart needed).
//   2. Fall back to restarting the plugin_loader service (backend, root flag).
//   3. Last resort: restart the Steam client.
export async function triggerReload(pluginName: string): Promise<"reloaded" | "restarting" | "failed"> {
  try {
    const loader = (window as any).DeckyPluginLoader;
    if (typeof loader?.reloadPlugin === "function") {
      await loader.reloadPlugin(pluginName);
      logEvent("INFO", "update reload: hot-reloaded plugin", { pluginName });
      return "reloaded";
    }
  } catch {
    // fall through to service restart
  }
  try {
    await restartPluginLoader();
    logEvent("INFO", "update reload: restarting plugin_loader", { pluginName });
    return "restarting";
  } catch {
    // fall through to Steam restart
  }
  try {
    (window as any).SteamClient?.System?.RestartSteamClient?.();
    return "restarting";
  } catch {
    logEvent("ERROR", "update reload: all reload strategies failed", { pluginName });
    return "failed";
  }
}
