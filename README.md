# Trailer TV

Brings back the old SteamOS "Trailer TV" feature. When your Steam Deck or PC goes idle,
it plays random game trailers from the Steam store instead of showing a blank screen.

Designed for living-room or docked game mode. If your Deck is plugged into a TV, the TV
handles its own display. The plugin just keeps playing trailers until you press a button.

## Features

- Plays real game trailers from the Steam store when your Deck or PC sits idle, instead of a blank screen
- Pick the source: Latest, Popular, Trending, or Random
- Respects your Steam Deck lock screen. With a Security PIN set, waking out of Trailer TV locks the Deck and asks for the PIN before your library shows up
- Audio off by default, with a toggle when you want sound
- Works docked to a TV or handheld

## Requirements

- [Decky Loader](https://decky.xyz) installed
- Network connection (trailers stream from Steam's servers)

## Usage

1. Install via the releases page ZIP (latest) for the first time. After this, you can use the built-in updater
2. The screensaver activates after your configured idle time
3. Press any button or touch the screen to dismiss
4. Use the Quick Access Menu (QAM) to change the trailer source, audio, and idle timeout

## Settings

| Setting | Description |
|---|---|
| Enabled | Master on/off toggle |
| Trailers | Source: Latest, Popular, Trending, or Random |
| Play audio | Muted by default (a screensaver probably should not blare) |
| Start after idle | How long before the screensaver fires (0 = follow Steam's dim timeout) |

## Lock screen

Trailer TV respects your Steam Deck lock screen setting. If you have a PIN set under Steam
Settings > Security, waking out of the screensaver locks the Deck and shows the PIN prompt
before anyone reaches your library. It works like waking from sleep with a PIN set, so
leaving trailers running somewhere public does not hand over your session.

With no PIN set, dismissing the screensaver drops you back to your library.

## Known limitations

Screen dim on Steam Deck: while a trailer plays, the Deck still dims its own screen after
the idle timeout. That dim is gamescope (the Deck's compositor) lowering the backlight on
its own timer, and a plugin cannot override it. The input nudge, brightness write-back, the
Steam dim setting, and the browser wake lock were all tried, and none of them stop it. The
full write-up is in docs/dim-prevention-attempts.md.

It does not matter for the docked setup the plugin targets. With the Deck connected to a TV,
the TV drives its own display and the trailers keep playing there. Only the Deck's own panel
dims, and you are looking at the TV.

## How it works

On idle, the plugin opens a fullscreen player and streams HLS trailers via hls.js. It
pulls from Steam's featured categories (top sellers, new releases, specials) and builds
the playlist in the background so playback starts right away. New trailers get added as
they load. When the player loops through everything, it fetches a fresh batch.

## Updates

Open the QAM, tap "Settings / Updates", and check for updates there. No file management
needed.

## License

GPL-3.0-or-later
