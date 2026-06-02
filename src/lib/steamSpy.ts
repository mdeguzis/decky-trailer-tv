// Debug spy: wrap SteamClient methods and log any call whose (serialized) args
// carry a timeout-like number, to capture EXACTLY what the Settings "dim after"
// slider invokes to push the timeout to gamescope. Move the slider with this
// installed, then read the `steam-spy call` log lines.
import { logEvent } from "./backend";

declare const SteamClient: any;

const restorers: Array<() => void> = [];

function serialize(args: any[]): string {
  try {
    return JSON.stringify(args, (_k, v) => (typeof v === "function" ? "[fn]" : v));
  } catch {
    return "";
  }
}

// True if the serialized args contain any integer in a plausible timeout range
// (seconds). Catches 300, "300", { foo: 300 }, etc.
function isInteresting(serialized: string): boolean {
  const nums = serialized.match(/\d+/g);
  if (!nums) return false;
  return nums.some((n) => {
    const v = parseInt(n, 10);
    return v >= 5 && v <= 86400;
  });
}

// Extract readable protobuf message names from a base64 SharedConnection payload.
function decodeMsgNames(b64: string): string {
  try {
    const bytes = atob(b64);
    const matches = bytes.match(/[A-Za-z][A-Za-z0-9_.]{5,}/g);
    return matches ? matches.join(",") : "";
  } catch {
    return "";
  }
}

// Only surface IPC messages plausibly about display/power/idle settings.
const SETTINGS_MSG_RE = /setting|backlight|dim|idle|display|power|suspend|sleep|screensaver|brightness/i;

function wrapNamespace(name: string, ns: any): void {
  if (!ns || typeof ns !== "object") return;
  for (const key of Object.keys(ns)) {
    if (key.startsWith("RegisterFor")) continue; // noisy event subscriptions
    let orig: any;
    try {
      orig = ns[key];
    } catch {
      continue;
    }
    if (typeof orig !== "function") continue;
    const full = `${name}.${key}`;
    const isSharedMsg = name === "SharedConnection" && key.startsWith("SendMsg");
    const wrapped = function (this: any, ...args: any[]) {
      try {
        if (isSharedMsg && typeof args[1] === "string") {
          // SharedConnection.SendMsg(type, base64proto): decode the message name.
          const names = decodeMsgNames(args[1]);
          if (names && SETTINGS_MSG_RE.test(names)) {
            logEvent("INFO", "steam-spy IPC", { m: full, names, b64: args[1].slice(0, 400) });
          }
        } else if (args.length > 0) {
          const s = serialize(args);
          if (isInteresting(s)) {
            logEvent("INFO", "steam-spy call", { m: full, args: s.slice(0, 300) });
          }
        }
      } catch {
        /* never break the call */
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
      /* read-only prop; skip */
    }
  }
}

/** Install the spy across all SteamClient namespaces. Returns an uninstaller. */
export function startSteamSpy(): () => void {
  try {
    for (const nsName of Object.keys(SteamClient)) {
      wrapNamespace(nsName, SteamClient[nsName]);
    }
    // a couple of nested namespaces worth covering explicitly
    wrapNamespace("System.Display", SteamClient.System?.Display);
    wrapNamespace("System.UI", SteamClient.System?.UI);
    logEvent("INFO", "steam-spy installed (broad)", {});
  } catch (e) {
    logEvent("WARNING", "steam-spy install failed", { reason: String(e) });
  }
  return () => {
    for (const r of restorers.splice(0)) r();
  };
}
