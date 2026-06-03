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

from .http_client import HttpError, curl_download, curl_json

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
        # On the developer channel the tag is the static "developer"; surface the
        # release NAME instead ("Developer build (<sha>)") so the frontend can
        # show the commit and compare it against the locally installed
        # .build-commit for version matching.
        if channel == "developer":
            latest = str(data.get("name") or data.get("tag_name") or "developer")
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
    except HttpError as he:
        # curl reached GitHub but got an HTTP error. A 404 just means nothing's
        # been published on this channel yet (no release, or the repo/tag
        # doesn't exist) -- surface that as an explicit, actionable message
        # rather than a raw curl error.
        if he.status == 404:
            if channel == "developer":
                msg = "No developer release published yet (HTTP 404)"
            else:
                msg = f"No published {channel} release found yet (HTTP 404)"
        else:
            msg = f"GitHub returned HTTP {he.status} for the {channel} channel"
        decky.logger.error(
            "check_for_update: %s | channel=%s url=%s status=%d",
            msg, channel, he.url, he.status,
        )
        return {"success": False, "error": msg, "current_version": current_version}
    except Exception as exc:
        decky.logger.error("check_for_update: failed | channel=%s err=%s", channel, exc)
        return {"success": False, "error": str(exc), "current_version": current_version}


def list_releases(
    limit: int = 10,
    include_prereleases: bool = True,
    channel: str = "release",
) -> dict[str, Any]:
    """Return releases for the release-notes carousel.

    Output shape per entry: version, name, body (markdown), published_at,
    prerelease flag, developer flag, html_url.

    channel="developer" merges per-build dev tags (from list_dev_tags) at the
    top, then real GitHub Releases. The rolling 'developer' Release is always
    filtered out of the history (dev tags replace it as per-build history). Any
    other channel returns only real Releases.
    """
    try:
        raw = curl_json(
            _ALL_RELEASES_URL,
            headers=["Accept: application/vnd.github.v3+json"],
            timeout=15,
        )
        out: list[dict[str, Any]] = []
        if channel == "developer":
            dev_half = max(1, limit // 2)
            dev_tags = list_dev_tags(limit=dev_half).get("releases", [])
            out.extend(dev_tags)
        for r in raw:
            tag = str(r.get("tag_name", "") or "")
            if tag == "developer":
                # Rolling Release is the updater's download source, never history.
                continue
            is_pre = bool(r.get("prerelease"))
            if is_pre and not include_prereleases:
                continue
            out.append(
                {
                    "version": tag.lstrip("v"),
                    "name": str(r.get("name", "") or tag),
                    "body": str(r.get("body", "") or ""),
                    "published_at": str(r.get("published_at", "") or ""),
                    "prerelease": is_pre,
                    "developer": False,
                    "html_url": str(r.get("html_url", "") or ""),
                }
            )
            if len(out) >= limit:
                break
        decky.logger.debug(
            "list_releases: ok | channel=%s returned=%d", channel, len(out[:limit])
        )
        return {"success": True, "releases": out[:limit]}
    except Exception as exc:
        decky.logger.error("list_releases: failed | channel=%s err=%s", channel, exc)
        return {"success": False, "error": str(exc), "releases": []}


def list_dev_tags(limit: int = 5) -> dict[str, Any]:
    """Return the N most recent dev-history tags (dev-<version>-<sha>).

    Persistent git tags created by `make github-dev-release`, outside the
    GitHub Releases page. Each annotated tag's message holds the same notes the
    rolling 'developer' Release carries, so the carousel can show dev build
    history without polluting the public releases page. Falls back to the commit
    subject when a tag is lightweight or its annotation fetch fails.
    """
    try:
        refs = curl_json(
            f"https://api.github.com/repos/{GITHUB_REPO}/git/matching-refs/tags/dev-",
            headers=["Accept: application/vnd.github.v3+json"],
            timeout=15,
        )
        if not isinstance(refs, list):
            return {"success": True, "releases": []}
        # Newest tags come last in git ref order; reverse so the carousel's
        # first card is the most recent dev build.
        refs = list(reversed(refs))[:limit]
        out: list[dict[str, Any]] = []
        for ref in refs:
            ref_name = str(ref.get("ref", ""))
            tag_short = ref_name.removeprefix("refs/tags/")
            obj = ref.get("object", {}) or {}
            obj_sha = str(obj.get("sha", ""))
            obj_type = str(obj.get("type", ""))
            if not obj_sha:
                continue
            message = ""
            tagger_date = ""
            if obj_type == "tag":
                try:
                    tag_obj = curl_json(
                        f"https://api.github.com/repos/{GITHUB_REPO}/git/tags/{obj_sha}",
                        headers=["Accept: application/vnd.github.v3+json"],
                        timeout=10,
                    )
                    message = str(tag_obj.get("message", "") or "")
                    tagger_date = str(tag_obj.get("tagger", {}).get("date", "") or "")
                except Exception as inner:
                    decky.logger.warning(
                        "list_dev_tags: tag obj fetch failed | tag=%s err=%s", tag_short, inner
                    )
            if not message:
                try:
                    commit = curl_json(
                        f"https://api.github.com/repos/{GITHUB_REPO}/commits/{obj_sha}",
                        headers=["Accept: application/vnd.github.v3+json"],
                        timeout=10,
                    )
                    message = str(commit.get("commit", {}).get("message", "") or "")
                    tagger_date = tagger_date or str(
                        commit.get("commit", {}).get("author", {}).get("date", "") or ""
                    )
                except Exception:
                    pass
            out.append(
                {
                    "version": tag_short.removeprefix("dev-"),
                    "name": tag_short,
                    "body": message,
                    "published_at": tagger_date,
                    "prerelease": False,
                    "developer": True,
                    "html_url": f"https://github.com/{GITHUB_REPO}/releases/tag/{tag_short}",
                }
            )
        return {"success": True, "releases": out}
    except Exception as exc:
        decky.logger.error("list_dev_tags: failed | err=%s", exc)
        return {"success": False, "error": str(exc), "releases": []}


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
