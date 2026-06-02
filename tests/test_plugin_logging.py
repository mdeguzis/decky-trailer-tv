"""Tests for the Logs-tab backend reader."""
from __future__ import annotations

import sys

from lib import plugin_logging


def test_get_log_contents_returns_tail(tmp_path, monkeypatch):
    log = tmp_path / "plugin.log"
    log.write_text("".join(f"line {i}\n" for i in range(500)))
    # get_log_contents reads decky.DECKY_PLUGIN_LOG (decky is stubbed in conftest).
    monkeypatch.setattr(sys.modules["decky"], "DECKY_PLUGIN_LOG", str(log), raising=False)

    out = plugin_logging.get_log_contents(max_lines=100)
    lines = out.splitlines()
    assert len(lines) == 100
    assert lines[-1] == "line 499"  # tail, newest last
    assert lines[0] == "line 400"


def test_get_log_contents_missing_file_is_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(
        sys.modules["decky"], "DECKY_PLUGIN_LOG", str(tmp_path / "absent.log"), raising=False
    )
    assert plugin_logging.get_log_contents() == ""
