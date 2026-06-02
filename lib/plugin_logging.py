"""Lightweight logging used by both backend code and frontend event relay."""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("decky-trailer-tv")


def get_log_contents(max_lines: int = 300) -> str:
    """Return the tail of the plugin log file for the in-plugin Logs tab.

    Reads decky.DECKY_PLUGIN_LOG and caps the result so we don't shove a huge
    file across the callable bridge. Returns an empty string (not an error) when
    the file doesn't exist yet, so the frontend can show a friendly "no logs".
    """
    try:
        import decky  # type: ignore[import-untyped]

        path = decky.DECKY_PLUGIN_LOG
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        return "".join(lines[-max_lines:])
    except FileNotFoundError:
        return ""
    except Exception as exc:  # noqa: BLE001 - surface read errors in the viewer
        logger.warning("get_log_contents: failed to read log | err=%s", exc)
        return f"(could not read log: {exc})"


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
