"""Trailer TV -- Decky Loader plugin backend.

Decky's loader imports this module and instantiates `Plugin`; each async method
becomes a callable the React frontend can invoke. A disk-cached playlist of
featured Steam-store trailers is built on demand and on a TTL, then handed to the
frontend hls.js player.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error
from lib.backlight import read_backlight
from lib.http_client import curl_json
from lib.playlist import get_candidate_appids, fetch_clip
from lib.plugin_logging import get_log_contents as _get_log_contents, log_frontend_event
from lib.plugin_updater import (
    check_for_update as _updater_check,
    list_releases as _updater_list_releases,
    make_initial_status as _updater_make_status,
    start_apply_update as _updater_start,
)
from lib.settings import load_settings, save_settings
from lib.steam_config import read_dim_seconds, write_dim_seconds, read_lock_screen_settings

# A value large enough that gamescope effectively never dims while active.
_DIM_DISABLED_SECONDS = 86400

PLAYLIST_TTL_SECONDS = 6 * 60 * 60


class Plugin:
    """Backend API for Trailer TV."""

    def __init__(self) -> None:
        runtime = Path(decky.DECKY_PLUGIN_RUNTIME_DIR)
        runtime.mkdir(parents=True, exist_ok=True)
        self._runtime = runtime
        self._settings_path = runtime / "settings.json"
        self._playlist_path = runtime / "playlist.json"
        self._dim_backup_path = runtime / "dim_backup.json"
        self._playlist: list[dict[str, Any]] = []
        self._playlist_source: str = ""
        self._playlist_built_at: float = 0.0
        self._playlist_building: bool = False
        self._playlist_candidates: int = 0
        self._update_status: dict[str, Any] = _updater_make_status()
        self._update_lock = threading.Lock()
        self._update_cancel = threading.Event()
        self._played_history: list[dict[str, Any]] = []

    async def _main(self) -> None:
        decky.logger.info("Trailer TV backend starting")
        # Crash recovery: if a backup exists, we exited while the dim was disabled.
        if self._dim_backup_path.exists():
            decky.logger.warning("dim backup found on start -- restoring user's dim settings")
            await self.restore_dim()
        # Log lock screen state so it's visible in logs without triggering the screensaver.
        lock = read_lock_screen_settings()
        decky.logger.info("lock screen | has_pin=%s source=%s", lock.get("has_pin"), lock.get("source"))
        # Pre-warm the playlist so it's ready before the screensaver first fires.
        await self.refresh_playlist()

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
        """Return current clips immediately; kick off a background build if stale or forced.

        Returns whatever has been built so far so the player can start without waiting
        for all clips to load. The frontend polls and appends new clips as they arrive.
        """
        settings = load_settings(self._settings_path)
        source = settings.get("source", "popular")
        fresh = (time.time() - self._playlist_built_at) < PLAYLIST_TTL_SECONDS
        same_source = source == self._playlist_source

        if fresh and same_source and not force_refresh:
            decky.logger.debug(
                "get_playlist: cache hit | source=%s count=%d building=%s",
                source, len(self._playlist), self._playlist_building,
            )
            return self._playlist

        if not self._playlist_building:
            await self.refresh_playlist()

        return self._playlist

    async def refresh_playlist(self) -> list[dict[str, Any]]:
        """Reset the playlist and start an async background fill; return immediately."""
        if self._playlist_building:
            decky.logger.debug("refresh_playlist: build already running, skipping")
            return self._playlist
        settings = load_settings(self._settings_path)
        source = settings.get("source", "popular")
        self._playlist = []
        self._playlist_source = source
        self._playlist_built_at = time.time()
        asyncio.create_task(self._fill_playlist_bg(source))
        decky.logger.info("refresh_playlist: background build started | source=%s", source)
        return self._playlist

    async def is_playlist_building(self) -> bool:
        """Return True while the background playlist fill is still running."""
        return self._playlist_building

    async def get_playlist_count(self) -> int:
        """Return the number of clips built so far (useful for live refresh progress)."""
        return len(self._playlist)

    async def get_build_status(self) -> dict[str, Any]:
        """Return live build progress: built count, candidate total, and building flag."""
        return {
            "building": self._playlist_building,
            "count": len(self._playlist),
            "total": self._playlist_candidates,
        }

    async def _fill_playlist_bg(self, source: str) -> None:
        """Fetch every available candidate clip and append to self._playlist as each arrives."""
        self._playlist_building = True
        self._playlist_candidates = 0
        loop = asyncio.get_running_loop()
        try:
            appids = await loop.run_in_executor(None, get_candidate_appids, curl_json, source)
            self._playlist_candidates = len(appids)
            decky.logger.info("playlist_bg: got %d candidates | source=%s", len(appids), source)
            for appid in appids:
                try:
                    clip = await loop.run_in_executor(None, fetch_clip, curl_json, appid)
                except Exception as exc:  # noqa: BLE001
                    decky.logger.debug("playlist_bg: fetch failed | appid=%d err=%s", appid, exc)
                    continue
                if clip:
                    self._playlist.append(clip)
                    decky.logger.debug(
                        "playlist_bg: clip added | appid=%d name=%s count=%d",
                        appid, clip.get("name"), len(self._playlist),
                    )
        except Exception as exc:  # noqa: BLE001
            decky.logger.error("playlist_bg: fatal error | source=%s err=%s", source, exc)
        finally:
            self._playlist_building = False
            decky.logger.info(
                "playlist_bg: done | source=%s count=%d", source, len(self._playlist)
            )

    async def record_played_clip(self, appid: int, name: str) -> None:
        """Record a clip as played; keeps most recent at index 0, no duplicates."""
        self._played_history = [e for e in self._played_history if e["appid"] != appid]
        self._played_history.insert(0, {"appid": appid, "name": name})
        self._played_history = self._played_history[:100]
        decky.logger.debug("record_played_clip | appid=%d name=%s total=%d", appid, name, len(self._played_history))

    async def get_played_history(self) -> list[dict[str, Any]]:
        """Return played clips most-recent-first."""
        return list(self._played_history)

    async def get_plugin_version(self) -> str:
        """Return the version string Decky knows about."""
        return getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")

    async def get_build_commit(self) -> str:
        """Return the git commit SHA baked into this build (.build-commit).

        Used by the updater to tell whether the rolling developer build on
        GitHub is the same commit already installed locally.
        """
        try:
            path = os.path.join(decky.DECKY_PLUGIN_DIR, ".build-commit")
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read().strip() or "dev"
        except Exception as exc:  # noqa: BLE001
            decky.logger.warning("get_build_commit: failed | err=%s", exc)
        return "dev"

    async def check_for_update(self, channel: str = "release") -> dict[str, Any]:
        """Check GitHub Releases for a newer version; returns update info dict."""
        current = getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")
        return _updater_check(current, channel=channel)

    async def list_releases(
        self,
        limit: int = 10,
        include_prereleases: bool = True,
        channel: str = "release",
    ) -> dict[str, Any]:
        """Return releases (+ dev-tag history on the developer channel) for the
        release-notes carousel."""
        return _updater_list_releases(
            limit=limit,
            include_prereleases=include_prereleases,
            channel=channel,
        )

    async def apply_update(self, zip_url: str, version: str) -> dict[str, Any]:
        """Start a background download-and-install; poll get_update_status() for progress."""
        with self._update_lock:
            if self._update_status.get("state") == "running":
                return {"ok": False, "error": "Update already in progress"}
        self._update_cancel.clear()
        _updater_start(
            zip_url, version, decky.DECKY_PLUGIN_DIR,
            self._update_status, self._update_lock, self._update_cancel,
        )
        return {"ok": True}

    async def get_update_status(self) -> dict[str, Any]:
        """Return a snapshot of the current update progress."""
        with self._update_lock:
            return dict(self._update_status)

    async def cancel_update(self) -> dict[str, Any]:
        """Signal the in-progress update to stop."""
        self._update_cancel.set()
        decky.logger.info("cancel_update: cancel signal sent")
        return {"ok": True}

    async def restart_plugin_loader(self) -> dict[str, Any]:
        """Restart the plugin_loader service so a freshly installed update loads.

        Returns immediately; the restart fires ~1.5s later so the frontend can
        show a spinner first. The service restart relaunches this Python backend
        with the new files. Requires the 'root' plugin flag (see plugin.json).
        """
        import subprocess

        def _do_restart() -> None:
            time.sleep(1.5)
            decky.logger.info("restart_plugin_loader: restarting plugin_loader service")
            try:
                subprocess.run(
                    ["sudo", "-n", "/usr/bin/systemctl", "restart", "plugin_loader"],
                    timeout=10,
                    check=True,
                )
            except Exception as exc:  # noqa: BLE001
                decky.logger.error("restart_plugin_loader: failed | err=%s", exc)

        threading.Thread(target=_do_restart, daemon=True, name="tt-restart-loader").start()
        decky.logger.info("restart_plugin_loader: restart scheduled in 1.5s")
        return {"ok": True}

    async def get_dim_settings(self) -> dict[str, Any]:
        """Backlight-dim timeouts (seconds) from config.vdf; values may be None."""
        dim = read_dim_seconds()
        decky.logger.debug(
            "get_dim_settings | battery=%s ac=%s source=%s",
            dim.get("battery"), dim.get("ac"), dim.get("source"),
        )
        return dim

    async def get_backlight(self) -> dict[str, Any]:
        """Real hardware backlight from sysfs (detects the idle dim)."""
        return read_backlight()

    async def disable_dim(self) -> dict[str, Any]:
        """Raise the backlight-dim timeout so gamescope won't dim while active.

        Backs up the user's original values to disk first (crash-safe restore).
        If a backup already exists we're already disabled -- leave it alone.
        """
        if not self._dim_backup_path.exists():
            current = read_dim_seconds()
            self._dim_backup_path.write_text(
                json.dumps({"battery": current.get("battery"), "ac": current.get("ac")})
            )
        result = write_dim_seconds(_DIM_DISABLED_SECONDS, _DIM_DISABLED_SECONDS)
        decky.logger.info("disable_dim | ok=%s prev=%s", result.get("ok"), result.get("previous"))
        return result

    async def restore_dim(self) -> dict[str, Any]:
        """Restore the user's original backlight-dim timeouts and clear the backup."""
        if not self._dim_backup_path.exists():
            return {"ok": True, "noop": True}
        saved = json.loads(self._dim_backup_path.read_text())
        result = write_dim_seconds(saved.get("battery"), saved.get("ac"))
        self._dim_backup_path.unlink(missing_ok=True)
        decky.logger.info("restore_dim | ok=%s restored=%s", result.get("ok"), saved)
        return result

    async def get_lock_screen_settings(self) -> dict[str, Any]:
        """Return whether a Steam Deck lock screen PIN is configured (never the PIN itself)."""
        result = read_lock_screen_settings()
        decky.logger.debug("get_lock_screen_settings | has_pin=%s source=%s", result.get("has_pin"), result.get("source"))
        return result

    async def lock_screen(self) -> dict[str, Any]:
        """Lock the Steam Deck screen.

        loginctl lock-sessions uses the system D-Bus (org.freedesktop.login1)
        which Steam game mode doesn't respond to for its PIN lock screen.
        Instead we call org.freedesktop.ScreenSaver.Lock on the deck user's
        session bus at /run/user/<uid>/bus, which Steam BPM does implement.
        Falls back to loginctl if dbus-send fails.
        """
        import os  # pylint: disable=import-outside-toplevel
        import pwd  # pylint: disable=import-outside-toplevel

        def _clean_env(base: dict) -> dict:
            """Strip PyInstaller paths from LD_LIBRARY_PATH."""
            e = base.copy()
            lp = e.get("LD_LIBRARY_PATH", "")
            cleaned = ":".join(p for p in lp.split(":") if p and "/tmp/_MEI" not in p)
            if cleaned:
                e["LD_LIBRARY_PATH"] = cleaned
            else:
                e.pop("LD_LIBRARY_PATH", None)
            return e

        # Build a minimal env with the deck user's session bus address.
        try:
            uid = pwd.getpwnam("deck").pw_uid
        except KeyError:
            uid = 1000
        session_bus = f"unix:path=/run/user/{uid}/bus"
        decky.logger.debug("lock_screen | trying session D-Bus | bus=%s uid=%s", session_bus, uid)
        try:
            # Must run as the deck user -- root cannot connect to the user's
            # session bus. su -c runs a login shell as deck with the bus address set.
            dbus_cmd = (
                f"DBUS_SESSION_BUS_ADDRESS={session_bus} "
                "dbus-send --session "
                "--dest=org.freedesktop.ScreenSaver "
                "--type=method_call "
                "/ScreenSaver "
                "org.freedesktop.ScreenSaver.Lock"
            )
            proc = await asyncio.create_subprocess_exec(
                "su", "-", "deck", "-c", dbus_cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            ok = proc.returncode == 0
            err = (stderr or b"").decode().strip() or None
            decky.logger.info("lock_screen | dbus-send | ok=%s rc=%s err=%s", ok, proc.returncode, err)
            if ok:
                return {"ok": True, "method": "dbus-send"}
            decky.logger.warning("lock_screen | dbus-send failed, falling back to loginctl | err=%s", err)
        except Exception as exc:  # noqa: BLE001
            decky.logger.warning("lock_screen | dbus-send exception, falling back to loginctl | err=%s", exc)

        # Fallback: loginctl lock-sessions (system D-Bus).
        try:
            system_env = _clean_env(os.environ.copy())
            proc = await asyncio.create_subprocess_exec(
                "loginctl", "lock-sessions",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                env=system_env,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            ok = proc.returncode == 0
            err = (stderr or b"").decode().strip() or None
            decky.logger.info("lock_screen | loginctl | ok=%s rc=%s err=%s", ok, proc.returncode, err)
            return {"ok": ok, "error": err, "method": "loginctl"}
        except Exception as exc:  # noqa: BLE001
            decky.logger.error("lock_screen | loginctl failed | err=%s", exc)
            return {"ok": False, "error": str(exc)}

    async def nudge_input(self) -> dict[str, Any]:
        """Emit a real input event via uinput to reset gamescope's idle timer."""
        from lib import uinput_nudge  # pylint: disable=import-outside-toplevel
        result = uinput_nudge.nudge()
        if not result.get("ok"):
            decky.logger.warning("nudge_input failed | err=%s", result.get("error"))
        return result

    async def stop_keep_awake(self) -> None:
        """Tear down the uinput virtual device when the screensaver exits."""
        from lib import uinput_nudge  # pylint: disable=import-outside-toplevel
        uinput_nudge.close()

    async def log_event(
        self, level: str, message: str, context: dict[str, Any] | None = None
    ) -> None:
        log_frontend_event(level, message, context)

    async def get_log_contents(self) -> str:
        """Return the tail of the plugin log file for the in-plugin Logs tab."""
        return _get_log_contents()
