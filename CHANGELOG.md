# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
