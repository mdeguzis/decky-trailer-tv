"""Lightweight logging used by both backend code and frontend event relay."""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("decky-trailer-tv")


def log_frontend_event(level: str, message: str, context: dict[str, Any] | None = None) -> None:
    """Relay a frontend log line into the plugin's Python logger.

    Always include source + field + outcome in `context` so failures are
    diagnosable without a debugger.
    """
    suffix = ""
    if context:
        suffix = f" | context={json.dumps(context, sort_keys=True)}"
    lvl = getattr(logging, level.upper(), logging.INFO)
    logger.log(lvl, "%s%s", message, suffix)
