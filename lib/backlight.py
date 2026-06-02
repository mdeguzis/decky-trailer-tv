"""Read the real hardware backlight from sysfs.

SteamClient's RegisterForBrightnessChanges reports the Steam brightness *setting*,
not the idle backlight dim. The actual backlight (which the idle-dim lowers) lives
in /sys/class/backlight/<device>/actual_brightness, so we read that to truly detect
(and potentially counter) the dim.
"""
from __future__ import annotations

import glob
import os
from typing import Any


def _backlight_dir() -> str | None:
    dirs = sorted(glob.glob("/sys/class/backlight/*"))
    return dirs[0] if dirs else None


def _read_int(path: str) -> int | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return int(handle.read().strip())
    except (OSError, ValueError):
        return None


def read_backlight() -> dict[str, Any]:
    """Return {raw, max, ratio, path}; values are None if sysfs is unavailable."""
    directory = _backlight_dir()
    if directory is None:
        return {"raw": None, "max": None, "ratio": None, "path": None}
    raw = _read_int(os.path.join(directory, "actual_brightness"))
    if raw is None:
        raw = _read_int(os.path.join(directory, "brightness"))
    maximum = _read_int(os.path.join(directory, "max_brightness"))
    ratio = round(raw / maximum, 4) if (raw is not None and maximum) else None
    return {"raw": raw, "max": maximum, "ratio": ratio, "path": directory}
