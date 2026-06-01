"""Shared backend helpers."""
from __future__ import annotations

import os


def system_command_env() -> dict[str, str]:
    """Build a clean env dict for shelling out to system tools.

    Decky bundles its own Python via PyOxidizer, which means LD_LIBRARY_PATH
    points at bundled OpenSSL/readline instead of the system copies. If that
    leaks into subprocess calls, curl dies with ``OPENSSL_3.2.0 not found``
    (decky-loader#729). The SSL cert vars point at the bundled CA bundle that
    system curl can't use either. Stripping all of these lets curl find its own
    libs the normal way.
    """
    env = os.environ.copy()
    for key in (
        "LD_LIBRARY_PATH",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "PYTHONHOME",
        "PYTHONPATH",
    ):
        env.pop(key, None)
    return env
