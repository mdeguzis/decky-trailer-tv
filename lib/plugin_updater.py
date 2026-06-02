"""Self-update logic for the Trailer TV plugin.

Checks GitHub Releases for a newer version and applies it by downloading
and extracting the release ZIP to the Decky plugins parent directory.
Progress is written to a shared status dict that the frontend polls via
get_update_status().
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]

from .http_client import curl_download, curl_json

GITHUB_REPO = "mdeguzis/decky-trailer-tv"
_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
_ALL_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=10"
_DEV_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/developer"


def _ver(v: str) -> tuple:
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except (ValueError, AttributeError):
        return (0,)


def make_initial_status() -> dict[str, Any]:
    return {
        "state": "idle",
        "stage": None,
        "downloaded_bytes": None,
        "total_bytes": None,
        "progress_fraction": None,
        "version": None,
        "error": None,
        "started_at": None,
        "finished_at": None,
    }


def check_for_update(current_version: str, channel: str = "release") -> dict[str, Any]:
    """Fetch the latest release from GitHub and compare against current_version.

    channel values:
      "release"     - latest stable GitHub release (no prereleases)
      "pre-release" - latest GitHub release including prereleases
      "developer"   - rolling developer tag (always considered newer)
    """
    try:
        if channel == "developer":
            data = curl_json(
                _DEV_RELEASE_URL,
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )
        elif channel == "pre-release":
            releases = curl_json(
                _ALL_RELEASES_URL,
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )
            data = next(
                (r for r in releases if r.get("prerelease")),
                releases[0] if releases else {},
            )
        else:
            data = curl_json(
                _RELEASES_URL,
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )

        latest = str(data.get("tag_name", "")).lstrip("v")
        zip_asset = next(
            (a for a in data.get("assets", []) if a["name"].endswith(".zip")),
            None,
        )
        zip_url: str | None = zip_asset["browser_download_url"] if zip_asset else None
        asset_size: int | None = zip_asset.get("size") if zip_asset else None
        # Developer channel is a rolling tag - always offer install if asset exists
        if channel == "developer":
            has_update = bool(zip_url)
        else:
            has_update = bool(latest and zip_url and _ver(latest) > _ver(current_version))
        decky.logger.debug(
            "check_for_update: current=%s latest=%s has_update=%s channel=%s",
            current_version, latest, has_update, channel,
        )
        return {
            "success": True,
            "current_version": current_version,
            "latest_version": latest,
            "has_update": has_update,
            "zip_url": zip_url,
            "asset_size": asset_size,
            "release_url": str(data.get("html_url", "")),
            "release_notes": str(data.get("body", "") or ""),
            "published_at": str(data.get("published_at", "") or ""),
            "channel": channel,
        }
    except Exception as exc:
        decky.logger.error("check_for_update: failed | channel=%s err=%s", channel, exc)
        return {"success": False, "error": str(exc), "current_version": current_version}


def start_apply_update(
    zip_url: str,
    version: str,
    plugin_dir: str,
    status: dict[str, Any],
    lock: threading.Lock,
    cancel: threading.Event,
) -> None:
    """Kick off a daemon thread to download and extract the update ZIP."""
    thread = threading.Thread(
        target=_run,
        args=(zip_url, version, plugin_dir, status, lock, cancel),
        daemon=True,
        name=f"tt-update-{version}",
    )
    thread.start()


def _run(
    zip_url: str,
    version: str,
    plugin_dir: str,
    status: dict[str, Any],
    lock: threading.Lock,
    cancel: threading.Event,
) -> None:
    plugin_parent_dir = os.path.dirname(plugin_dir)
    tmp_path = Path(tempfile.gettempdir()) / f"tt-update-{version}.zip"
    tmp_extract = Path(tempfile.gettempdir()) / f"tt-update-extract-{os.getpid()}"

    def _set(**kwargs: Any) -> None:
        with lock:
            status.update(kwargs)

    _set(
        state="running",
        stage="downloading",
        version=version,
        started_at=int(time.time()),
        downloaded_bytes=0,
        total_bytes=None,
        progress_fraction=None,
        error=None,
        finished_at=None,
    )

    def _on_progress(downloaded: int, total: int | None, fraction: float | None) -> None:
        _set(downloaded_bytes=downloaded, total_bytes=total, progress_fraction=fraction)

    try:
        decky.logger.info(
            "plugin_updater: downloading %s | url=%s dest=%s", version, zip_url, tmp_path
        )
        curl_download(
            zip_url, tmp_path, timeout=120,
            progress_callback=_on_progress,
            cancel_check=cancel.is_set,
        )

        if cancel.is_set():
            raise RuntimeError("Cancelled")

        size = tmp_path.stat().st_size
        _set(stage="extracting", progress_fraction=1.0)

        if tmp_extract.exists():
            shutil.rmtree(tmp_extract)
        tmp_extract.mkdir(parents=True)

        decky.logger.info(
            "plugin_updater: extracting %d bytes to %s | version=%s", size, tmp_extract, version
        )
        with zipfile.ZipFile(tmp_path) as zf:
            zf.extractall(tmp_extract)

        extracted_dirs = [d for d in tmp_extract.iterdir() if d.is_dir()]
        if len(extracted_dirs) != 1:
            raise RuntimeError(f"Expected 1 top-level dir in zip, found {len(extracted_dirs)}")

        extracted_dir = extracted_dirs[0]
        plugin_name = os.path.basename(plugin_dir)
        target_path = Path(plugin_parent_dir) / plugin_name

        final_staging = tmp_extract / plugin_name
        if extracted_dir.name != plugin_name:
            decky.logger.info(
                "plugin_updater: renaming %s -> %s", extracted_dir.name, plugin_name
            )
            extracted_dir.rename(final_staging)
        else:
            final_staging = extracted_dir

        decky.logger.info("plugin_updater: installing to %s", target_path)
        installed = False

        try:
            if target_path.exists():
                shutil.rmtree(target_path)
            shutil.move(str(final_staging), str(target_path))
            installed = True
        except PermissionError:
            decky.logger.info("plugin_updater: direct replace failed (root-owned), trying sudo")

        if not installed:
            try:
                subprocess.run(["sudo", "-n", "rm", "-rf", str(target_path)], check=True, timeout=10)
                subprocess.run(["sudo", "-n", "mv", str(final_staging), str(target_path)], check=True, timeout=10)
                installed = True
            except (subprocess.CalledProcessError, FileNotFoundError):
                decky.logger.info("plugin_updater: sudo failed, trying rsync")

        if not installed:
            try:
                subprocess.run(
                    ["rsync", "-a", "--delete", str(final_staging) + "/", str(target_path) + "/"],
                    check=True, timeout=30,
                )
                installed = True
            except (subprocess.CalledProcessError, FileNotFoundError):
                decky.logger.warning("plugin_updater: rsync failed")

        if not installed:
            staging_left = str(final_staging)
            decky.logger.error("plugin_updater: all install methods failed, staged at %s", staging_left)
            raise RuntimeError(
                f"Plugin dir is root-owned. Run on the Deck terminal:\n"
                f"sudo rm -rf {target_path} && sudo mv {staging_left} {target_path} "
                f"&& sudo systemctl restart plugin_loader"
            )

        _set(state="success", stage=None, finished_at=int(time.time()))
        decky.logger.info("plugin_updater: done | version=%s dest=%s", version, target_path)

    except Exception as exc:
        _set(state="error", error=str(exc), finished_at=int(time.time()))
        decky.logger.error("plugin_updater: failed | version=%s err=%s", version, exc)
    finally:
        tmp_path.unlink(missing_ok=True)
        if tmp_extract.exists():
            shutil.rmtree(tmp_extract, ignore_errors=True)
