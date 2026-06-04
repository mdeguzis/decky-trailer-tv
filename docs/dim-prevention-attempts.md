# Screen dim prevention: attempts and findings

Status: unsolved. Tracking GitHub issue: mdeguzis/decky-trailer-tv#1.

## The problem

While Trailer TV plays, SteamOS still dims the screen after the idle timeout. The
backlight fades down to roughly 3 percent even though a trailer is playing.

## Root cause (confirmed on-device)

The dim is gamescope (the Wayland compositor) lowering the **hardware backlight** on
its own idle timer. The on-screen debug overlay during a dim showed:

- `brightness: 100%` (the Steam brightness setting never changed)
- `backlight: 3%` (the physical backlight dropped)
- `RegisterForBrightnessChanges` fired once at registration with level 1, then never
  again during the fade

So the dim never touches the Steam brightness setting and never emits a brightness
event. It is invisible to the Steam brightness API. gamescope owns it.

gamescope does honor the Steam `idle_backlight_dim` setting: moving the Settings >
Power "Dim after" slider changes the live dim timeout. That is the one lever known to
work. The trouble is writing that setting from a plugin (see below).

## What was tried (all confirmed failing on-device)

| Attempt | How | Result |
|---|---|---|
| uinput input nudge | `lib/uinput_nudge.py` emits a real input event via `/dev/uinput` every few seconds to reset gamescope's seat idle | Event emits ok, gamescope ignores it. Backlight still dims. |
| Brightness write-back | `SteamClient.System.Display.SetBrightness` re-asserts the saved level when a drop is detected | The brightness setting is already 100 percent; gamescope dims the backlight independently, so re-asserting does nothing (and fights to the floor) |
| config.vdf write | Backend writes `IdleBacklightDim{AC,Battery}Seconds` in `config.vdf` | Written ok, but gamescope does not re-read `config.vdf` live (persistence only) |
| UpdateSettings protobuf | Frontend hand-builds a protobuf (`idle_backlight_dim_battery_seconds`=1, `_ac_seconds`=2, `display_adaptive_brightness_enabled`=7) and calls `SteamClient.System.UpdateSettings(base64)` | Call returns ok, but `configAfter` read back is still 60. The write never applied. The grepped field numbers are evidently not the message `UpdateSettings` actually consumes |
| Adaptive brightness off | Same UpdateSettings call sets `display_adaptive_brightness_enabled=0` | Did not apply (same as above), and brightness was not the cause anyway |
| Screen Wake Lock | `navigator.wakeLock.request('screen')` on the player, released on exit | Lock acquired successfully, but the backlight still dimmed. CEF's wake lock does not reach gamescope |

## Why we cannot just talk to gamescope

gamescope is a separate compositor process. A Decky plugin is JavaScript inside Steam's
CEF plus a Python backend. Neither has an IPC channel into gamescope. The only ways to
influence it are:

1. Real input on its seat (uinput tried, ignored).
2. The Steam settings it reads at runtime (`idle_backlight_dim`). The clean setter
   `SetIdleBacklightDimSeconds` lives on a module-internal store reached via `m.Get()`,
   not exposed as a `window` global. The protobuf shortcut to `UpdateSettings` lands on
   the wrong field, so the setting never changes.
3. Wayland idle-inhibit (what `navigator.wakeLock` uses). gamescope did not honor it.

## The remaining lead

The Settings slider works, so gamescope honors a correct `idle_backlight_dim` write. To
land that from a plugin we need either:

- the exact protobuf message and field numbers that `SteamClient.System.UpdateSettings`
  expects (our descriptor-grepped numbers are wrong for that message), or
- a path to the real `SetIdleBacklightDimSeconds` store singleton.

Until then, the dim cannot be prevented from the plugin. On a Deck docked to a TV the
Deck's own screen dimming does not matter, since the TV drives its own display.

## Keep-awake strategies left in the code

`off` (default), `settings` (UpdateSettings write), `uinput` (nudge), `brightness`
(write-back). All remain behind the debug panel for future experiments. The on-screen
overlay (debug mode) shows `brightness %`, `backlight %`, and a dim-event counter so any
future attempt can be measured precisely.
