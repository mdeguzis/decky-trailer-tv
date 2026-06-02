"""HTTP helper that shells out to curl.

We use curl instead of urllib/requests because SteamOS has known SSL cert
issues with Python's bundled OpenSSL. curl uses the system CA store.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

import decky  # type: ignore[import-untyped]

from .plugin_utils import system_command_env

ProgressCallback = Callable[[int, int | None, float | None], None]


def curl_json(
    url: str,
    *,
    headers: list[str] | None = None,
    timeout: int = 25,
) -> dict[str, Any] | list[Any]:
    """Fetch and parse JSON from a URL by shelling out to curl.

    Runs with a cleaned env (see system_command_env) so Decky's bundled OpenSSL
    doesn't make system curl fail with ``OPENSSL_3.2.0 not found``.
    """
    command = [
        "curl", "-LfsS", "--http1.1",
        "--connect-timeout", "20",
        "--retry", "2", "--retry-all-errors", "--retry-delay", "2",
        "--max-time", str(timeout),
        "-H", "User-Agent: Mozilla/5.0",
        url,
    ]
    for header in headers or []:
        command.extend(["-H", header])
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout + 10,
        env=system_command_env(), check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip() or f"curl failed with exit code {result.returncode}"
        )
    return json.loads(result.stdout)  # type: ignore[no-any-return]


def curl_download(  # pylint: disable=too-many-arguments,too-many-locals,too-many-branches
    url: str,
    destination: Path,
    *,
    timeout: int = 900,
    total_bytes: int | None = None,
    progress_callback: ProgressCallback | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> None:
    """Download a file with curl, polling for progress and watching for cancel."""
    command = [
        "curl", "-LfsS", "--http1.1", "-4",
        "--connect-timeout", "20",
        "--retry", "2", "--retry-all-errors", "--retry-delay", "2",
        "--speed-time", "60", "--speed-limit", "1024",
        "--max-time", str(timeout),
        url, "-o", str(destination),
    ]
    process = subprocess.Popen(  # pylint: disable=consider-using-with
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env=system_command_env(),
    )
    start_time = time.time()
    last_log_time = start_time
    last_size = -1

    try:
        while True:
            if cancel_check and cancel_check():
                process.terminate()
                try:
                    stdout, stderr = process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    stdout, stderr = process.communicate(timeout=5)
                msg = (stderr or stdout or "Cancelled").strip()
                raise RuntimeError(msg or "Cancelled")

            returncode = process.poll()
            now = time.time()

            if now - last_log_time >= 10:
                current_size = destination.stat().st_size if destination.exists() else 0
                growth = current_size - max(last_size, 0) if last_size >= 0 else current_size
                decky.logger.info(
                    "curl_download: progress | dest=%s bytes=%d growth=%d elapsed=%ds",
                    destination.name, current_size, growth, int(now - start_time),
                )
                if progress_callback:
                    fraction = (
                        max(0.0, min(1.0, current_size / total_bytes))
                        if total_bytes and total_bytes > 0 else None
                    )
                    progress_callback(current_size, total_bytes, fraction)
                last_size = current_size
                last_log_time = now

            if returncode is not None:
                stdout, stderr = process.communicate(timeout=5)
                if returncode != 0 or not destination.exists() or destination.stat().st_size <= 0:
                    raise RuntimeError(
                        (stderr or stdout or f"curl failed ({returncode})").strip()
                    )
                if progress_callback:
                    current_size = destination.stat().st_size
                    fraction = (
                        max(0.0, min(1.0, current_size / total_bytes))
                        if total_bytes and total_bytes > 0 else None
                    )
                    progress_callback(current_size, total_bytes, fraction)
                return

            if now - start_time > timeout + 30:
                process.kill()
                process.communicate(timeout=5)
                raise RuntimeError(f"curl exceeded timeout after {timeout + 30}s")

            time.sleep(1)
    finally:
        pass
