"""Tests for check_for_update's channel + HTTP-error handling."""
from __future__ import annotations

from unittest import mock

from lib.http_client import HttpError
from lib import plugin_updater


def test_developer_404_returns_explicit_actionable_error():
    url = "https://api.github.com/repos/mdeguzis/decky-trailer-tv/releases/tags/developer"
    with mock.patch.object(
        plugin_updater, "curl_json", side_effect=HttpError(404, url)
    ):
        result = plugin_updater.check_for_update("1.0.0", channel="developer")
    assert result["success"] is False
    assert result["error"] == "No developer release published yet (HTTP 404)"
    assert result["current_version"] == "1.0.0"


def test_release_404_returns_channel_specific_error():
    url = "https://api.github.com/repos/mdeguzis/decky-trailer-tv/releases/latest"
    with mock.patch.object(
        plugin_updater, "curl_json", side_effect=HttpError(404, url)
    ):
        result = plugin_updater.check_for_update("1.0.0", channel="release")
    assert result["success"] is False
    assert "release" in result["error"]
    assert "404" in result["error"]


def test_non_404_http_error_reports_status():
    url = "https://api.github.com/repos/mdeguzis/decky-trailer-tv/releases/latest"
    with mock.patch.object(
        plugin_updater, "curl_json", side_effect=HttpError(503, url)
    ):
        result = plugin_updater.check_for_update("1.0.0", channel="release")
    assert result["success"] is False
    assert "503" in result["error"]


def test_developer_channel_surfaces_release_name_with_commit():
    data = {
        "tag_name": "developer",
        "name": "Developer build (abc1234)",
        "html_url": "https://gh/dev",
        "body": "rolling",
        "assets": [{"name": "x-dev.zip", "browser_download_url": "https://gh/x.zip", "size": 10}],
    }
    with mock.patch.object(plugin_updater, "curl_json", return_value=data):
        res = plugin_updater.check_for_update("0.5.1", channel="developer")
    assert res["success"] is True
    # latest_version is the release NAME (with commit), not the static "developer"
    # tag, so the frontend can compare it against the local .build-commit.
    assert res["latest_version"] == "Developer build (abc1234)"
    assert res["has_update"] is True  # asset exists


def test_list_releases_maps_rows_and_filters_rolling_developer_tag():
    raw = [
        {"tag_name": "v0.4.0", "name": "Trailer TV v0.4.0", "body": "## Changes\n- x",
         "published_at": "2026-06-02T12:00:00Z", "prerelease": False,
         "html_url": "https://gh/0.4.0"},
        {"tag_name": "developer", "name": "Developer build", "body": "rolling",
         "prerelease": True, "html_url": "https://gh/dev"},  # rolling tag -> filtered
        {"tag_name": "v0.3.0-rc1", "name": "RC1", "body": "rc",
         "prerelease": True, "html_url": "https://gh/rc1"},
    ]
    with mock.patch.object(plugin_updater, "curl_json", return_value=raw):
        res = plugin_updater.list_releases(limit=10, include_prereleases=True, channel="release")
    assert res["success"] is True
    versions = [r["version"] for r in res["releases"]]
    assert versions == ["0.4.0", "0.3.0-rc1"]  # 'developer' dropped, "v" stripped
    assert all(r["developer"] is False for r in res["releases"])


def test_list_releases_excludes_prereleases_when_requested():
    raw = [
        {"tag_name": "v0.4.0", "prerelease": False, "html_url": "https://gh/0.4.0"},
        {"tag_name": "v0.5.0-beta", "prerelease": True, "html_url": "https://gh/beta"},
    ]
    with mock.patch.object(plugin_updater, "curl_json", return_value=raw):
        res = plugin_updater.list_releases(include_prereleases=False, channel="release")
    assert [r["version"] for r in res["releases"]] == ["0.4.0"]


def test_list_releases_developer_channel_merges_dev_tags_first():
    raw = [{"tag_name": "v0.4.0", "prerelease": False, "html_url": "https://gh/0.4.0"}]
    dev = {"success": True, "releases": [
        {"version": "0.4.0-abc123", "name": "dev-0.4.0-abc123", "body": "dev notes",
         "published_at": "", "prerelease": False, "developer": True, "html_url": "https://gh/dev"},
    ]}
    with mock.patch.object(plugin_updater, "curl_json", return_value=raw), \
         mock.patch.object(plugin_updater, "list_dev_tags", return_value=dev):
        res = plugin_updater.list_releases(limit=10, channel="developer")
    assert res["releases"][0]["developer"] is True  # dev tag merged at the top
    assert res["releases"][1]["version"] == "0.4.0"


def test_list_releases_returns_error_dict_on_failure():
    with mock.patch.object(plugin_updater, "curl_json", side_effect=HttpError(404, "u")):
        res = plugin_updater.list_releases(channel="release")
    assert res["success"] is False
    assert res["releases"] == []
