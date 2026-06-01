"""Build a playlist of Steam store trailers from the public store API.

Network access is injected (a `fetch_json` callable) so the parsing logic is
unit-testable with fixtures and has no hidden I/O.
"""
from __future__ import annotations

import random
from typing import Any, Callable

FEATURED_URL = "https://store.steampowered.com/api/featuredcategories/?l=english&cc=us"
APPDETAILS_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english&cc=us"

FetchJson = Callable[[str], Any]

# QAM trailer-type dropdown -> which featured buckets to pull app IDs from.
# "latest"/"popular" keep Steam's natural ordering; "random" shuffles a mix.
SOURCE_BUCKETS: dict[str, list[str]] = {
    "latest": ["new_releases"],
    "popular": ["top_sellers"],
    "random": ["specials", "new_releases", "top_sellers", "coming_soon"],
}
DEFAULT_SOURCE = "popular"


def buckets_for_source(source: str) -> list[str]:
    """Map a dropdown source to featured buckets, falling back to the default."""
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


def build_playlist(
    fetch_json: FetchJson,
    source: str,
    *,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Fetch featured app IDs for `source`, then per-app trailers, into a playlist.

    "random" shuffles a mix of all buckets; "latest"/"popular" keep Steam's order.
    Logging is the caller's responsibility (main.py) so this stays testable.
    """
    categories = buckets_for_source(source)
    featured = fetch_json(FEATURED_URL)
    appids = parse_featured_appids(featured, categories)
    if source == "random":
        random.shuffle(appids)
    appids = appids[:limit]

    clips: list[dict[str, Any]] = []
    for appid in appids:
        try:
            details = fetch_json(APPDETAILS_URL.format(appid=appid))
        except Exception:  # noqa: BLE001 - one bad app must not kill the batch
            continue
        clip = parse_trailer(details, appid)
        if clip:
            clips.append(clip)
    return clips
