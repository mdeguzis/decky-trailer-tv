from lib.playlist import (
    FEATURED_URL,
    STEAMSPY_2W_URL,
    STEAMSPY_FOREVER_URL,
    PROTON_PULSE_SEARCH_INDEX_URL,
    buckets_for_source,
    fetch_clip,
    get_candidate_appids,
    parse_featured_appids,
    parse_trailer,
)


def test_buckets_for_source_maps_dropdown_types():
    assert buckets_for_source("latest") == ["new_releases"]
    assert buckets_for_source("popular") == ["top_sellers"]
    # random and trending use SteamSpy, not featured buckets -- fall back to popular
    assert buckets_for_source("random") == ["top_sellers"]
    # Unknown falls back to the default (popular).
    assert buckets_for_source("bogus") == ["top_sellers"]


def test_parse_featured_appids_dedupes_across_buckets():
    data = {
        "specials": {"items": [{"id": 10}, {"id": 20}]},
        "top_sellers": {"items": [{"id": 20}, {"id": 30}]},
        "coming_soon": {"items": [{"id": 40}]},
    }
    assert parse_featured_appids(data, ["specials", "top_sellers"]) == [10, 20, 30]


def test_parse_featured_appids_ignores_missing_buckets_and_bad_ids():
    data = {"specials": {"items": [{"id": 10}, {"name": "no id"}, {"id": "x"}]}}
    assert parse_featured_appids(data, ["specials", "nope"]) == [10]


def _appdetails(appid, movies, name="Some Game", success=True, app_type="game"):
    return {
        str(appid): {
            "success": success,
            "data": {
                "name": name,
                "type": app_type,
                "movies": movies,
                "header_image": "hdr.jpg",
            },
        }
    }


def test_parse_trailer_skips_non_game_types():
    movies = [{"id": 1, "hls_h264": "a.m3u8", "thumbnail": "t.jpg", "highlight": True}]
    # Hardware (e.g. the "Steam Deck" store app) and DLC must be skipped.
    assert parse_trailer(_appdetails(70, movies, app_type="hardware"), 70) is None
    assert parse_trailer(_appdetails(71, movies, app_type="dlc"), 71) is None
    assert parse_trailer(_appdetails(72, movies, app_type="game"), 72) is not None


def test_parse_trailer_prefers_highlight_and_uses_hls():
    movies = [
        {"id": 1, "name": "Teaser", "hls_h264": "a.m3u8", "thumbnail": "t1.jpg", "highlight": False},
        {"id": 2, "name": "Launch", "hls_h264": "b.m3u8", "thumbnail": "t2.jpg", "highlight": True},
    ]
    clip = parse_trailer(_appdetails(50, movies), 50)
    assert clip == {"appid": 50, "name": "Some Game", "hls_url": "b.m3u8", "thumbnail": "t2.jpg"}


def test_parse_trailer_returns_none_when_no_movies_or_no_hls():
    assert parse_trailer(_appdetails(60, []), 60) is None
    assert parse_trailer(_appdetails(61, [{"id": 1, "thumbnail": "t.jpg"}]), 61) is None


def _adult_appdetails(appid, **data_extra):
    movies = [{"id": 1, "hls_h264": "a.m3u8", "thumbnail": "t.jpg", "highlight": True}]
    details = _appdetails(appid, movies)
    details[str(appid)]["data"].update(data_extra)
    return details


def test_parse_trailer_blocks_adult_content_descriptors():
    # 1 = some nudity/sexual, 3 = adult only sexual, 4 = frequent nudity/sexual.
    for ids in ([1], [3], [4], [2, 4]):
        assert parse_trailer(_adult_appdetails(80, content_descriptors={"ids": ids}), 80) is None, ids


def test_parse_trailer_blocks_18_plus_and_adult_genres():
    assert parse_trailer(_adult_appdetails(81, required_age=18), 81) is None
    assert parse_trailer(_adult_appdetails(82, required_age="18"), 82) is None
    assert parse_trailer(_adult_appdetails(83, genres=[{"description": "Sexual Content"}]), 83) is None


def test_parse_trailer_allows_non_adult_signals():
    # Violence/gore (2) and general mature (5) are allowed; age under 18 is fine.
    clip = parse_trailer(
        _adult_appdetails(84, content_descriptors={"ids": [2, 5]}, required_age=17), 84
    )
    assert clip is not None
    assert parse_trailer(_appdetails(62, [{"id": 1}], success=False), 62) is None


def test_get_candidate_appids_primary_bucket_first_then_extras():
    featured = {
        "top_sellers": {"items": [{"id": 1}, {"id": 2}, {"id": 3}]},
        "new_releases": {"items": [{"id": 99}, {"id": 2}]},  # 2 dups across buckets
        "specials": {"items": [{"id": 50}]},
    }
    captured = {}

    def fake_fetch(url):
        captured["url"] = url
        return featured

    # "popular" keeps top_sellers FIRST, then appends the other buckets as extras
    # (deduped, order preserved) so the rotation isn't tiny.
    result = get_candidate_appids(fake_fetch, "popular")
    # Order is shuffled now (so playback doesn't always start the same), so assert
    # on membership rather than position: all bucket IDs present, deduped.
    assert set(result) == {1, 2, 3, 99, 50}
    assert result.count(2) == 1  # deduped across buckets
    assert captured["url"] == FEATURED_URL


def test_get_candidate_appids_random_uses_steamspy_and_supplements_from_cdn():
    spy_2w = {"730": {"appid": 730}, "440": {"appid": 440}}
    spy_forever = {"570": {"appid": 570}, "730": {"appid": 730}}
    # CDN entry for a game NOT in SteamSpy lists, plus a duplicate.
    cdn_data = [["999", "Some Game", "gold", 5, 0], ["730", "CS", "gold", 100, 0]]
    calls = []

    def fake_fetch(url):
        calls.append(url)
        if url == STEAMSPY_2W_URL:
            return spy_2w
        if url == STEAMSPY_FOREVER_URL:
            return spy_forever
        if url == PROTON_PULSE_SEARCH_INDEX_URL:
            return cdn_data
        return {}

    result = get_candidate_appids(fake_fetch, "random")
    # SteamSpy IDs + unique CDN supplement, no duplicates
    assert set(result) == {730, 440, 570, 999}
    assert STEAMSPY_2W_URL in calls
    assert STEAMSPY_FOREVER_URL in calls
    assert PROTON_PULSE_SEARCH_INDEX_URL in calls
    assert FEATURED_URL not in calls


def test_get_candidate_appids_random_falls_back_to_cdn_when_steamspy_empty():
    cdn_data = [["100", "Game A", "gold", 5, 0], ["200", "Game B", "silver", 3, 0]]
    calls = []

    def fake_fetch(url):
        calls.append(url)
        if url == PROTON_PULSE_SEARCH_INDEX_URL:
            return cdn_data
        return {}  # SteamSpy returns empty dicts

    result = get_candidate_appids(fake_fetch, "random")
    assert set(result) == {100, 200}
    assert PROTON_PULSE_SEARCH_INDEX_URL in calls


def test_get_candidate_appids_trending_uses_steamspy_2w():
    spy_2w = {"730": {"appid": 730}, "440": {"appid": 440}}
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return spy_2w if url == STEAMSPY_2W_URL else {}

    result = get_candidate_appids(fake_fetch, "trending")
    assert set(result) == {730, 440}
    assert calls == [STEAMSPY_2W_URL]


def test_fetch_clip_builds_clip_and_skips_trailerless():
    # Mirrors how main.py's background fill drives the live path: candidates from
    # get_candidate_appids, then fetch_clip per app. App 2 has no movies -> None.
    details = {
        1: {"1": {"success": True, "data": {"name": "G1", "type": "game", "movies": [{"id": 9, "hls_h264": "1.m3u8", "highlight": True, "thumbnail": "x"}]}}},
        2: {"2": {"success": True, "data": {"name": "G2", "type": "game", "movies": []}}},  # skipped (no movies)
        3: {"3": {"success": True, "data": {"name": "G3", "type": "game", "movies": [{"id": 7, "hls_h264": "3.m3u8", "highlight": True, "thumbnail": "y"}]}}},
    }

    def fake_fetch(url):
        appid = int(url.split("appids=")[1].split("&")[0])
        return details[appid]

    clips = [c for appid in (1, 2, 3) if (c := fetch_clip(fake_fetch, appid))]
    assert [c["appid"] for c in clips] == [1, 3]
    assert clips[0]["hls_url"] == "1.m3u8"
