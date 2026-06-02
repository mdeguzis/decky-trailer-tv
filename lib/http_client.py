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


class HttpError(RuntimeError):
    """Raised when curl completed but the server returned an HTTP >=400 status.

    Carries the numeric ``status`` plus the request ``url`` and a short ``body``
    snippet so callers (and the logs) can tell a 404 (nothing published yet)
    apart from a 5xx (GitHub down) or a transport failure (no HTTP response at
    all). Subclasses RuntimeError so existing ``except Exception`` callers keep
    working.
    """

    def __init__(self, status: int, url: str, body: str = "") -> None:
        self.status = status
        self.url = url
        self.body = body
        super().__init__(f"HTTP {status} from {url}")


def curl_json(
    url: str,
    *,
    headers: list[str] | None = None,
    timeout: int = 25,
) -> dict[str, Any] | list[Any]:
    """Fetch and parse JSON from a URL by shelling out to curl.

    Runs with a cleaned env (see system_command_env) so Decky's bundled OpenSSL
    doesn't make system curl fail with ``OPENSSL_3.2.0 not found``.

    We deliberately do NOT pass ``-f``: that flag makes curl abort on HTTP
    errors with an opaque ``curl: (22)`` and throws away the status code and
    response body -- useless when debugging a 404 on the Deck. Instead we append
    ``%{http_code}`` to stdout and branch in Python so transport failures, HTTP
    error statuses, and bad JSON each get a distinct, logged outcome. Raises
    :class:`HttpError` (with the status) on HTTP >=400.
    """
    command = [
        "curl", "-sS", "-L", "--http1.1",
        "--connect-timeout", "20",
        "--retry", "2", "--retry-delay", "2",
        "--max-time", str(timeout),
        "-w", "\n%{http_code}",
        "-H", "User-Agent: Mozilla/5.0",
        url,
    ]
    for header in headers or []:
        command.extend(["-H", header])
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout + 10,
        env=system_command_env(), check=False,
    )

    # Transport-level failure: curl itself errored (DNS, TLS, connection reset,
    # the bundled-OpenSSL clash, etc) so there's no usable HTTP response. The
    # real reason lives in stderr.
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        decky.logger.error(
            "curl_json: transport failure | url=%s rc=%d stderr=%s",
            url, result.returncode, stderr or "(empty)",
        )
        raise RuntimeError(stderr or f"curl exited with code {result.returncode}")

    # We appended "\n%{http_code}", so the status is the final line and the body
    # is everything before it. The body can contain newlines, so split on the
    # LAST newline only.
    raw = result.stdout
    newline = raw.rfind("\n")
    if newline == -1:
        decky.logger.error("curl_json: no HTTP status in curl output | url=%s", url)
        raise RuntimeError(f"curl returned no HTTP status for {url}")
    body = raw[:newline]
    status_text = raw[newline + 1:].strip()
    try:
        status = int(status_text)
    except ValueError:
        status = 0

    if status >= 400:
        snippet = body.strip().replace("\n", " ")[:200]
        decky.logger.error(
            "curl_json: http error | url=%s status=%d body=%s",
            url, status, snippet or "(empty)",
        )
        raise HttpError(status, url, body)

    decky.logger.debug(
        "curl_json: ok | url=%s status=%d bytes=%d", url, status, len(body),
    )
    try:
        return json.loads(body)  # type: ignore[no-any-return]
    except json.JSONDecodeError as exc:
        snippet = body.strip().replace("\n", " ")[:200]
        decky.logger.error(
            "curl_json: invalid JSON | url=%s status=%d err=%s body=%s",
            url, status, exc, snippet or "(empty)",
        )
        raise RuntimeError(f"Invalid JSON from {url}: {exc}") from exc


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
