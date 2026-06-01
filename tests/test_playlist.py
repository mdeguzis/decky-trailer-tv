from lib.playlist import (
    FEATURED_URL,
    buckets_for_source,
    build_playlist,
    parse_featured_appids,
    parse_trailer,
)


def test_buckets_for_source_maps_dropdown_types():
    assert buckets_for_source("latest") == ["new_releases"]
    assert buckets_for_source("popular") == ["top_sellers"]
    assert set(buckets_for_source("random")) == {
        "specials",
        "new_releases",
        "top_sellers",
        "coming_soon",
    }
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


def _appdetails(appid, movies, name="Some Game", success=True):
    return {
        str(appid): {
            "success": success,
            "data": {"name": name, "movies": movies, "header_image": "hdr.jpg"},
        }
    }


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
    assert parse_trailer(_appdetails(62, [{"id": 1}], success=False), 62) is None


def test_build_playlist_fetches_details_and_skips_trailerless():
    featured = {"top_sellers": {"items": [{"id": 1}, {"id": 2}, {"id": 3}]}}
    details = {
        1: {"1": {"success": True, "data": {"name": "G1", "movies": [{"id": 9, "hls_h264": "1.m3u8", "highlight": True, "thumbnail": "x"}]}}},
        2: {"2": {"success": True, "data": {"name": "G2", "movies": []}}},  # skipped
        3: {"3": {"success": True, "data": {"name": "G3", "movies": [{"id": 7, "hls_h264": "3.m3u8", "highlight": True, "thumbnail": "y"}]}}},
    }

    def fake_fetch(url):
        if url == FEATURED_URL:
            return featured
        appid = int(url.split("appids=")[1].split("&")[0])
        return details[appid]

    clips = build_playlist(fake_fetch, "popular", limit=10)
    assert [c["appid"] for c in clips] == [1, 3]
    assert clips[0]["hls_url"] == "1.m3u8"
