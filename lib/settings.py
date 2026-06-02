"""Persisted plugin settings with safe defaults and key whitelisting."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": True,         # master on/off; off pauses the auto-trigger
    "source": "popular",     # latest | popular | random (QAM dropdown)
    "audio": False,          # muted by default; a TV screensaver shouldn't blare
    "idleSeconds": 120,      # fallback when Steam's power settings can't be read
    "customIdleSeconds": 0,  # 0 = follow Steam's dim; else must be < Steam's dim
    "debug": False,          # show the live status/stats panel in the QAM
}


def load_settings(path: Path) -> dict[str, Any]:
    """Return saved settings merged over defaults; defaults if file is absent/corrupt."""
    merged = dict(DEFAULT_SETTINGS)
    try:
        saved = json.loads(Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return merged
    if isinstance(saved, dict):
        for key in DEFAULT_SETTINGS:
            if key in saved:
                merged[key] = saved[key]
    return merged


def save_settings(path: Path, partial: dict[str, Any]) -> dict[str, Any]:
    """Merge `partial` (whitelisted keys only) over current settings and persist."""
    current = load_settings(path)
    for key in DEFAULT_SETTINGS:
        if key in partial:
            current[key] = partial[key]
    Path(path).write_text(json.dumps(current, separators=(",", ":")))
    return current
