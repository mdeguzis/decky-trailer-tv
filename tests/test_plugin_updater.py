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
