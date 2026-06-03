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


def _set_value(text: str, key: str, value: int) -> str:
    """Replace the numeric value of a VDF "key" "value" pair, preserving whitespace."""
    pattern = re.compile(r'("' + re.escape(key) + r'"\s+")\d+(")')
    return pattern.sub(r"\g<1>" + str(value) + r"\g<2>", text, count=1)


def read_lock_screen_settings() -> dict[str, object]:
    """Return whether a Steam Deck lock screen PIN is configured.

    Reads LockScreenSettings from config.vdf. Returns has_pin=True if strPIN is
    non-empty. Never exposes the PIN value itself.
    """
    import json as _json  # pylint: disable=import-outside-toplevel
    path = find_config_vdf()
    if path is None:
        return {"has_pin": False, "source": None}
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return {"has_pin": False, "source": str(path)}
    m = re.search(r'"LockScreenSettings"\s+"({[^"]+})"', text)
    if not m:
        return {"has_pin": False, "source": str(path)}
    try:
        settings = _json.loads(m.group(1).replace('\\"', '"'))
        has_pin = bool(settings.get("strPIN", ""))
        return {"has_pin": has_pin, "source": str(path)}
    except (ValueError, KeyError):
        return {"has_pin": False, "source": str(path)}


def write_dim_seconds(battery: int | None, ac: int | None) -> dict[str, object]:
    """Set IdleBacklightDim{Battery,AC}Seconds in config.vdf. Returns prev + ok."""
    path = find_config_vdf()
    if path is None:
        return {"ok": False, "error": "config.vdf not found"}
    try:
        text = path.read_text(errors="ignore")
        previous = parse_dim_seconds(text)
        if battery is not None and previous["battery"] is not None:
            text = _set_value(text, "IdleBacklightDimBatterySeconds", battery)
        if ac is not None and previous["ac"] is not None:
            text = _set_value(text, "IdleBacklightDimACSeconds", ac)
        path.write_text(text)
        return {"ok": True, "previous": previous}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
