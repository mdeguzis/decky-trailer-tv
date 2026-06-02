"""Read the user's backlight-dim timeouts from Steam's config.vdf.

These (`IdleBacklightDim{Battery,AC}Seconds`) are NOT exposed in the frontend
settingsStore -- only the screensaver/suspend timeouts are. They live in
config.vdf and Steam rewrites them immediately when the user changes the
"dim after" setting in Game Mode.
"""
from __future__ import annotations

import re
from pathlib import Path

# Same Steam dir candidates decky-proton-pulse checks, most common first.
STEAM_DIR_CANDIDATES = [
    ".local/share/Steam",
    ".steam/steam",
    ".steam/root",
    ".steam/debian-installation",
    ".var/app/com.valvesoftware.Steam/data/Steam",
]

_DIM_BATTERY_RE = re.compile(r'"IdleBacklightDimBatterySeconds"\s+"(\d+)"')
_DIM_AC_RE = re.compile(r'"IdleBacklightDimACSeconds"\s+"(\d+)"')


def parse_dim_seconds(text: str) -> dict[str, int | None]:
    """Pull the two backlight-dim values out of config.vdf text (None if absent)."""
    battery = _DIM_BATTERY_RE.search(text)
    ac = _DIM_AC_RE.search(text)
    return {
        "battery": int(battery.group(1)) if battery else None,
        "ac": int(ac.group(1)) if ac else None,
    }


def find_config_vdf() -> Path | None:
    """Locate the active Steam config.vdf under the real user's home."""
    import decky  # type: ignore[import-untyped]  # pylint: disable=import-error,import-outside-toplevel

    home = Path(decky.DECKY_USER_HOME)
    for candidate in STEAM_DIR_CANDIDATES:
        path = home / candidate / "config" / "config.vdf"
        if path.is_file():
            return path
    return None


def read_dim_seconds() -> dict[str, int | None | str]:
    """Read backlight-dim seconds for battery + AC; values are None if unavailable."""
    path = find_config_vdf()
    if path is None:
        return {"battery": None, "ac": None, "source": None}
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return {"battery": None, "ac": None, "source": str(path)}
    result: dict[str, int | None | str] = dict(parse_dim_seconds(text))
    result["source"] = str(path)
    return result
