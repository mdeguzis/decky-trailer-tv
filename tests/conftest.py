"""Shared pytest setup.

``lib/http_client.py`` and ``lib/plugin_updater.py`` import the ``decky``
runtime module at top level, which only exists inside the Decky loader. Stub it
with a no-op logger so those modules can be imported and unit-tested off-device.
"""
from __future__ import annotations

import logging
import sys
import types

if "decky" not in sys.modules:
    decky_stub = types.ModuleType("decky")
    decky_stub.logger = logging.getLogger("decky")  # type: ignore[attr-defined]
    sys.modules["decky"] = decky_stub
