"""HTTP helper that shells out to curl.

We use curl instead of urllib/requests because SteamOS has known SSL cert
issues with Python's bundled OpenSSL. curl uses the system CA store.
"""
from __future__ import annotations

import json
import subprocess
from typing import Any


def curl_json(url: str, *, timeout: int = 25) -> dict[str, Any] | list[Any]:
    """Fetch and parse JSON from a URL by shelling out to curl."""
    command = [
        "curl", "-LfsS", "--http1.1",
        "--connect-timeout", "20",
        "--retry", "2", "--retry-all-errors", "--retry-delay", "2",
        "--max-time", str(timeout),
        "-H", "User-Agent: Mozilla/5.0",
        url,
    ]
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout + 10, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip() or f"curl failed with exit code {result.returncode}"
        )
    return json.loads(result.stdout)
