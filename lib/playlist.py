"""Build a playlist of Steam store trailers from the public store API.

Network access is injected (a `fetch_json` callable) so the parsing logic is
unit-testable with fixtures and has no hidden I/O.
"""
from __future__ import annotations

import random
from typing import Any, Callable

FEATURED_URL = "https://store.steampowered.com/api/featuredcategories/?l=english&cc=us"
APPDETAILS_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english&cc=us"

# SteamSpy returns ~100 real games per endpoint, updated daily, no auth required.
# Response shape: {"730": {"appid": 730, "name": "...", ...}, ...}
STEAMSPY_2W_URL = "https://steamspy.com/api.php?request=top100in2weeks"
STEAMSPY_FOREVER_URL = "https://steamspy.com/api.php?request=top100forever"

# Proton Pulse CDN: 6000+ real Steam games with ProtonDB data, updated daily.
# Shape: [[appId, title, tier, protondbCount, pulseCount], ...]
PROTON_PULSE_SEARCH_INDEX_URL = "https://www.proton-pulse.com/search-index.json"
# How many IDs to randomly sample from the full proton-pulse index.
PROTON_PULSE_SAMPLE_SIZE = 100

FetchJson = Callable[[str], Any]

# source -> which mode to use: "featured" or "steamspy"
SOURCE_MODE: dict[str, str] = {
    "latest":   "featured",
    "popular":  "featured",
    "trending": "steamspy_2w",
    "random":   "steamspy_both",
}

# featured-mode sources -> which buckets to lead with
SOURCE_BUCKETS: dict[str, list[str]] = {
    "latest":  ["new_releases"],
    "popular": ["top_sellers"],
}

# Every featured bucket, used to pad the candidate pool.
ALL_BUCKETS = ["top_sellers", "new_releases", "specials", "coming_soon"]
DEFAULT_SOURCE = "popular"


def get_candidate_appids(fetch_json: FetchJson, source: str) -> list[int]:
    """Return ordered/shuffled candidate app IDs for the given source.

    - popular/latest: Steam featured page, primary bucket first, rest appended.
    - trending: SteamSpy top-100 by players in the last 2 weeks.
    - random: SteamSpy top-100 (2-week) + top-100 (all-time) combined, shuffled.
      This gives ~200 distinct real games vs the ~56 from the featured page.
    """
    mode = SOURCE_MODE.get(source, "featured")

    if mode == "steamspy_2w":
        appids = _steamspy_appids(fetch_json, STEAMSPY_2W_URL)
        random.shuffle(appids)
        return appids

    if mode == "steamspy_both":
        appids_2w = _steamspy_appids(fetch_json, STEAMSPY_2W_URL)
        appids_forever = _steamspy_appids(fetch_json, STEAMSPY_FOREVER_URL)
        seen: set[int] = set(appids_2w)
        combined = list(appids_2w)
        for aid in appids_forever:
            if aid not in seen:
                combined.append(aid)
        # Supplement with a random sample from the Proton Pulse CDN (~6k games).
        # If SteamSpy completely failed (both endpoints empty), use the CDN as the
        # sole source so random still works without SteamSpy.
        pp_ids = _proton_pulse_appids(fetch_json)
        if combined:
            extras = [aid for aid in pp_ids if aid not in seen]
            combined.extend(extras)
        else:
            combined = pp_ids
        random.shuffle(combined)
        return combined

    # featured mode
    featured = fetch_json(FEATURED_URL)
    primary = SOURCE_BUCKETS.get(source, SOURCE_BUCKETS[DEFAULT_SOURCE])
    ordered = primary + [b for b in ALL_BUCKETS if b not in primary]
    return parse_featured_appids(featured, ordered)


def _proton_pulse_appids(fetch_json: FetchJson, sample_size: int = PROTON_PULSE_SAMPLE_SIZE) -> list[int]:
    """Fetch the Proton Pulse search index and return a random sample of app IDs.

    The index has ~6000 real Steam games with ProtonDB data -- far larger than
    the SteamSpy top-100 lists. We sample rather than using all of them to keep
    the candidate count manageable for the per-game appdetails fetch loop.
    """
    try:
        data = fetch_json(PROTON_PULSE_SEARCH_INDEX_URL)
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(data, list):
        return []
    appids: list[int] = []
    for entry in data:
        if isinstance(entry, (list, tuple)) and entry:
            try:
                appids.append(int(entry[0]))
            except (ValueError, TypeError):
                continue
    if len(appids) <= sample_size:
        return appids
    return random.sample(appids, sample_size)


def _steamspy_appids(fetch_json: FetchJson, url: str) -> list[int]:
    """Fetch a SteamSpy endpoint and return its app IDs as a list."""
    data = fetch_json(url)
    if not isinstance(data, dict):
        return []
    appids: list[int] = []
    for key, entry in data.items():
        if isinstance(entry, dict):
            aid = entry.get("appid")
        else:
            try:
                aid = int(key)
            except (ValueError, TypeError):
                continue
        if isinstance(aid, int) and aid > 0:
            appids.append(aid)
    return appids


def fetch_clip(fetch_json: FetchJson, appid: int) -> dict[str, Any] | None:
    """Fetch and parse trailer details for a single app; returns clip or None."""
    details = fetch_json(APPDETAILS_URL.format(appid=appid))
    return parse_trailer(details, appid)


def buckets_for_source(source: str) -> list[str]:
    """Map a featured-mode source to its primary featured buckets."""
    return SOURCE_BUCKETS.get(source, SOURCE_BUCKETS[DEFAULT_SOURCE])


def parse_featured_appids(data: dict[str, Any], categories: list[str]) -> list[int]:
    """Collect unique app IDs from the chosen featured buckets, order preserved."""
    appids: list[int] = []
    seen: set[int] = set()
    for category in categories:
        bucket = data.get(category)
        if not isinstance(bucket, dict):
            continue
        for item in bucket.get("items", []):
            appid = item.get("id")
            if isinstance(appid, int) and appid not in seen:
                seen.add(appid)
                appids.append(appid)
    return appids


def parse_trailer(appdetails: dict[str, Any], appid: int) -> dict[str, Any] | None:
    """Extract a single playable trailer for `appid`, or None if unavailable.

    Returns {appid, name, hls_url, thumbnail}. Prefers the movie flagged
    `highlight`; falls back to the first movie. Requires an `hls_h264` URL
    because CEF can only play HLS (not the dead progressive formats) via hls.js.
    """
    entry = appdetails.get(str(appid))
    if not isinstance(entry, dict) or not entry.get("success"):
        return None
    data = entry.get("data") or {}
    # Only real games -- skip hardware (e.g. "Steam Deck"), DLC, soundtracks, etc.
    if data.get("type") != "game":
        return None
    movies = data.get("movies") or []
    if not movies:
        return None
    chosen = next((m for m in movies if m.get("highlight")), movies[0])
    hls_url = chosen.get("hls_h264")
    if not hls_url:
        return None
    return {
        "appid": appid,
        "name": data.get("name") or f"App {appid}",
        "hls_url": hls_url,
        "thumbnail": chosen.get("thumbnail") or data.get("header_image"),
    }
