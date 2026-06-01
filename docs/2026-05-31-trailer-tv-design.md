# decky-trailer-tv — Design

Date: 2026-05-31
Status: approved (initial design)

## Background

A revival of the old SteamOS 1.x/2.x "Trailer TV" Big Picture feature: when the
machine went idle it played random game trailers from the Steam store instead of
showing a blank screen. Big Picture is gone; the modern equivalent on SteamOS 3.x
Game Mode is a Decky plugin. This project rebuilds the feature as `decky-trailer-tv`,
cloning the build/deploy/i18n scaffolding from `decky-proton-pulse`.

References:
- https://www.reddit.com/r/Steam/comments/4mis97/feature_request_expansion_to_trailertv/
- https://store.steampowered.com/news/app/593110/view/500579723494031419?l=english

## Settled decisions

- Form factor: Decky plugin, cloned from proton-pulse scaffolding (Makefile, build,
  deploy, i18n, pytest/vitest), trimmed to what this needs.
- Trigger: auto-activate on input idle.
- Content: random rotation through Steam's public "featured" store titles
  (specials / new releases / top sellers).
- Activation scope: configurable, default "docked or charging only".
- Playback: hls.js on the HLS H.264 stream. Legacy progressive .webm/.mp4 trailer
  URLs are gone (verified 404); Steam now serves DASH (.mpd) / HLS (.m3u8) only.

## Key technical findings (verified against live API on 2026-05-31)

- `https://store.steampowered.com/api/featuredcategories/?l=english&cc=us` returns
  app IDs under `specials`, `new_releases`, `top_sellers`, `coming_soon`.
- `https://store.steampowered.com/api/appdetails?appids=<id>&l=english&cc=us`
  returns a `movies` array. Each movie now exposes `dash_av1`, `dash_h264`,
  `hls_h264` (adaptive manifest URLs) plus `thumbnail` and `highlight`. The old
  `webm` / `mp4` progressive fields are null/absent.
- The HLS master manifest lists H.264/AAC variants at 1080p and 720p, which the
  Deck APU hardware-decodes (smooth, power-efficient for idle playback).
- CEF/Chromium (Steam UI) cannot play HLS/DASH in a bare `<video>` tag; hls.js
  (Media Source Extensions) is required.
- Steam store APIs are not CORS-enabled, so trailer data must be fetched by the
  Python backend (httpx), not frontend fetch(). Mirrors proton-pulse.

## Architecture & components

### Python backend (main.py)
- `PlaylistService`: fetch featured app IDs from `featuredcategories`, then
  `appdetails` per app, extract HLS movie URL + game name + capsule, build a
  cached shuffled playlist. Refresh on a TTL (default 6h) and on demand.
- `call_plugin_method` endpoints: `get_playlist()`, `refresh_playlist()`,
  `get_settings()`, `set_settings()`.
- Debug logging: every fetch logs source + field + outcome (which API, which
  appid, movie count, why an app was skipped). Throttles appdetails calls to
  respect rate limits; caches aggressively to disk (JSON).

### TypeScript frontend (src/)
- `TrailerPlayer`: fullscreen `routerHook` route at `/trailer-tv`; hls.js `<video>`
  cycling the playlist; light info overlay (game name + capsule); fade between clips.
- `idleWatcher`: global input listeners (gamepad / keyboard / mouse / touch) reset
  an idle timer; on threshold + power-gate pass, `Navigation.Navigate('/trailer-tv')`.
  Any input while active navigates back and starts a cooldown.
- `powerGate`: reads charging/docked state from `SteamClient.System`; enforces the
  docked-default scope.
- QAM panel: status, manual "Start now", settings (idle delay, scope, audio).

## Data flow

```
backend timer/TTL ──> featuredcategories (app IDs)
                        └─> appdetails per appid ──> {appid, name, hls_url, capsule}
                              └─> shuffle ──> cached playlist (JSON on disk)
frontend get_playlist() ──> TrailerPlayer cycles clips via hls.js
idleWatcher (idle N min + powerGate ok) ──> Navigate('/trailer-tv')
any input ──> Navigate(back) + cooldown
```

## Idle + power gating

- Idle: default 5 min of no input. Listeners on keydown, mousemove, gamepad
  activity, touch; debounced timer reset.
- Spike first: before building the full player, a throwaway test confirms the input
  listener fires in Game Mode and that Navigate to a fullscreen route takes over the
  screen. Highest-risk unknown.
- Power gate: default docked-or-charging only; configurable to "always".
- Exit: any input dismisses instantly; 10s cooldown before idle can re-arm.

## Settings (persisted backend-side, JSON)

- `idleMinutes` (default 5)
- `activationScope` (`docked_or_charging` default | `always`)
- `audio` (default muted; user toggles on)
- `clipMaxSeconds` (default 60; advance if a trailer runs long)
- `categories` (which featured buckets to pull)

## Error handling

- Apps with no `movies` are skipped (logged with appid + reason).
- HLS load failure on a clip: log + skip to next; 3 consecutive failures show a
  quiet "couldn't load trailers" card and retry a playlist refresh.
- Empty playlist (API down): idle trigger is a no-op, logged at WARNING.
- appdetails rate limits: backend throttles between calls and caches aggressively.

## Testing

- Python (pytest): playlist parsing (fixtures captured from the real API),
  movie-URL extraction, skip logic, settings round-trip.
- TypeScript (vitest): idle-timer logic, power-gate decisions, cooldown, playlist
  advance/wraparound. Pure logic, no DOM.
- Manual: `make deploy` to the Deck, dock, idle, confirm takeover.

## Spike result (2026-06-01) -- CONFIRMED WORKING

Validated on hardware (Deck at 192.168.1.203). All three unknowns passed:
- A `routerHook` fullscreen route (`/trailer-tv`) fully takes over the Game Mode
  screen (verified by remote screenshot).
- A self-contained idle watcher (DOM events + `navigator.getGamepads()` polling)
  fires the route after the idle window with no input.
- Remote control works without new tooling: `make take-screenshot PAGE=/trailer-tv`
  navigates the Deck to the route via the proton-pulse `steamRoute` prepare-action,
  and the CEF screenshot capture-to-clipboard works. `window.__TRAILER_TV_START__()`
  / `__TRAILER_TV_STOP__()` globals also drive it from the CEF console.

Decision: idle detection via our own input timer is viable; no need to find a
SteamClient "user idle" signal. Next: replace the placeholder overlay with the
real hls.js player fed by the backend playlist, then layer in the power gate and a
production idle timeout.

## Out of scope (v1, YAGNI)

Owned-library / wishlist sources, curated app-ID lists, per-game skip/like, video
caching to disk, multi-monitor. All deferred.
