# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-06-02

### Fixed
- QAM "View playlist" now opens Settings -> Trailer Playlist instead of launching
  the player. The manual player launch is now a separate "Play now" button.
- Synced the VERSION file and pyproject.toml to package.json (the packaged zip
  was still named from a stale 0.3.0).

### Changed
- Removed the QAM "Refresh trailers" button; refresh now lives on the Trailer
  Playlist tab.

## [0.5.0] - 2026-06-02

### Added
- Left sidebar navigation (Settings, Trailer Playlist, Trailer History, Logs,
  About) replacing the single scrolling settings page.
- Trailer Playlist tab: ordered, numbered list of upcoming trailers with
  thumbnails, a live count, a focusable Refresh button, and a Store link per row.
  Polls continuously so it fills in place.
- Logs tab with a full-screen scrollable log viewer (D-pad scroll + copy),
  backed by a new get_log_contents backend reader.
- About tab (version, description, GitHub/issue links).
- Persisted update channel (survives reopening the page).

### Fixed
- Self-update install failing with "Plugin dir is root-owned": the plugin now
  runs with the root flag, so it can replace its own files like it should.
- Updates auto-reload the plugin on success (restart_plugin_loader) instead of
  asking the user to restart Decky manually.
- Playlist no longer loads only ~6 trailers: candidate app IDs now draw from the
  source's primary featured bucket first, then the other buckets as extras.
- Trailer History Store button no longer overflows the right edge.
- Version labels route through formatVersion (no more "vDeveloper build (sha)").

### Changed
- QAM buttons relabeled: "Test" -> "View playlist", "View Playlist / Updates"
  -> "Settings".

## [0.4.0] - 2026-06-02

### Added
- Release-notes viewer: a "View release notes" button in the Updates section
  opens a carousel of the last 10 releases, each rendering parsed markdown
  (headings, bullets, paragraphs) with a channel pill, published date, and an
  Open-on-GitHub action. Shoulder buttons page between releases; B closes.
- Backend `list_releases` and `list_dev_tags`: history feed for the carousel.
  On the developer channel, per-build `dev-<version>-<sha>` tag history is
  merged in ahead of real releases; the rolling `developer` release is filtered
  out of history everywhere.
- Trailer lifecycle logging: `clip playback started` (on the `playing` event,
  with clip duration) and `clip ended` (with watched seconds).

## [0.3.1] - 2026-06-02

### Fixed
- Update check no longer fails with an opaque `curl: (22)`. `curl_json` captures
  the HTTP status and classifies transport, HTTP, and JSON errors separately,
  logging each with the URL and status.
- A 404 from the update check now reports an explicit, actionable message
  (for example "No developer release published yet (HTTP 404)") instead of a
  raw curl error.

### Changed
- Removed the dead `build_playlist` helper; the live background-fill path
  (`get_candidate_appids` + `fetch_clip`) now has direct test coverage.
