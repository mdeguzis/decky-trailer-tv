"""Trailer TV -- Decky Loader plugin backend.

Decky's loader imports this module and instantiates `Plugin`; each async method
becomes a callable the React frontend can invoke. A disk-cached playlist of
featured Steam-store trailers is built on demand and on a TTL, then handed to the
frontend hls.js player.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error
from lib.http_client import curl_json
from lib.playlist import build_playlist
from lib.plugin_logging import log_frontend_event
from lib.settings import load_settings, save_settings
from lib.steam_config import read_dim_seconds

PLAYLIST_TTL_SECONDS = 6 * 60 * 60


class Plugin:
    """Backend API for Trailer TV."""

    def __init__(self) -> None:
        runtime = Path(decky.DECKY_PLUGIN_RUNTIME_DIR)
        runtime.mkdir(parents=True, exist_ok=True)
        self._settings_path = runtime / "settings.json"
        self._playlist_path = runtime / "playlist.json"
        self._playlist: list[dict[str, Any]] = []
        self._playlist_source: str = ""
        self._playlist_built_at: float = 0.0

    async def _main(self) -> None:
        decky.logger.info("Trailer TV backend starting")

    async def _unload(self) -> None:
        decky.logger.info("Trailer TV backend unloading")

    # ----- frontend-callable methods -----

    async def get_settings(self) -> dict[str, Any]:
        return load_settings(self._settings_path)

    async def set_settings(self, partial: dict[str, Any]) -> dict[str, Any]:
        updated = save_settings(self._settings_path, partial)
        decky.logger.info("settings updated | %s", updated)
        return updated

    async def get_playlist(self, force_refresh: bool = False) -> list[dict[str, Any]]:
        """Return the cached playlist, rebuilding if stale, forced, or source changed."""
        settings = load_settings(self._settings_path)
        source = settings.get("source", "popular")
        fresh = (time.time() - self._playlist_built_at) < PLAYLIST_TTL_SECONDS
        same_source = source == self._playlist_source
        if self._playlist and fresh and same_source and not force_refresh:
            decky.logger.debug(
                "get_playlist: served cache | source=%s count=%d",
                source, len(self._playlist),
            )
            return self._playlist
        return await self.refresh_playlist()

    async def refresh_playlist(self) -> list[dict[str, Any]]:
        settings = load_settings(self._settings_path)
        source = settings.get("source", "popular")
        try:
            clips = build_playlist(curl_json, source, limit=30)
        except Exception as exc:  # noqa: BLE001
            decky.logger.error(
                "refresh_playlist failed | source=%s err=%s", source, exc
            )
            return self._playlist  # keep whatever we had
        self._playlist = clips
        self._playlist_source = source
        self._playlist_built_at = time.time()
        decky.logger.info(
            "playlist refreshed | source=%s count=%d", source, len(clips)
        )
        return clips

    async def get_dim_settings(self) -> dict[str, Any]:
        """Backlight-dim timeouts (seconds) from config.vdf; values may be None."""
        dim = read_dim_seconds()
        decky.logger.debug(
            "get_dim_settings | battery=%s ac=%s source=%s",
            dim.get("battery"), dim.get("ac"), dim.get("source"),
        )
        return dim

    async def log_event(
        self, level: str, message: str, context: dict[str, Any] | None = None
    ) -> None:
        log_frontend_event(level, message, context)
