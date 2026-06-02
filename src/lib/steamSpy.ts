// Debug spy: wrap SteamClient namespaces and log any call carrying a timeout-like
// number, so we can capture EXACTLY what the Settings "dim after" slider invokes
// to push the timeout to gamescope. Move the slider with this installed, then read
// the `steam-spy call` log lines.
import { logEvent } from "./backend";

declare const SteamClient: any;

const restorers: Array<() => void> = [];

// The dim/sleep timeouts are seconds in a plausible range; filter to those so the
// log isn't drowned by unrelated calls.
function isInteresting(args: any[]): boolean {
  return args.some((a) => typeof a === "number" && a >= 5 && a <= 86400);
}

function safeArgs(args: any[]): unknown {
  try {
    return args.map((a) => (typeof a === "function" ? "[fn]" : a));
  } catch {
    return "[unserializable]";
  }
}

function wrapNamespace(name: string, ns: any): void {
  if (!ns) return;
  for (const key of Object.keys(ns)) {
    let orig: any;
    try {
      orig = ns[key];
    } catch {
      continue;
    }
    if (typeof orig !== "function") continue;
    const full = `${name}.${key}`;
    const wrapped = function (this: any, ...args: any[]) {
      if (isInteresting(args)) {
        try {
          logEvent("INFO", "steam-spy call", { m: full, args: safeArgs(args) });
        } catch {
          /* never let logging break the call */
        }
      }
      return orig.apply(this, args);
    };
    try {
      ns[key] = wrapped;
      restorers.push(() => {
        try {
          ns[key] = orig;
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* some props are read-only; skip */
    }
  }
}

/** Install the spy. Returns an uninstall function that restores originals. */
export function startSteamSpy(): () => void {
  try {
    wrapNamespace("System", SteamClient.System);
    wrapNamespace("Settings", SteamClient.Settings);
    wrapNamespace("System.Display", SteamClient.System?.Display);
    wrapNamespace("System.UI", SteamClient.System?.UI);
    logEvent("INFO", "steam-spy installed", {});
  } catch (e) {
    logEvent("WARNING", "steam-spy install failed", { reason: String(e) });
  }
  return () => {
    for (const r of restorers.splice(0)) r();
  };
}
