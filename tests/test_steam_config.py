import sys
from unittest.mock import patch, MagicMock

# Stub the decky module so steam_config can be imported outside Decky
decky_stub = MagicMock()
decky_stub.DECKY_USER_HOME = "/home/deck"
sys.modules.setdefault("decky", decky_stub)

from lib.steam_config import parse_dim_seconds, _set_value, read_lock_screen_settings  # noqa: E402

CONFIG_SNIPPET = """
"InstallConfigStore"
{
    "Software"
    {
        "Valve"
        {
            "Steam"
            {
                "IdleBacklightDimBatterySeconds"    "60"
                "IdleBacklightDimACSeconds"     "1800"
            }
        }
    }
}
"""


def test_parse_dim_seconds_reads_both():
    assert parse_dim_seconds(CONFIG_SNIPPET) == {"battery": 60, "ac": 1800}


def test_parse_dim_seconds_missing_keys_are_none():
    assert parse_dim_seconds('"IdleBacklightDimACSeconds"   "300"') == {
        "battery": None,
        "ac": 300,
    }
    assert parse_dim_seconds("nothing here") == {"battery": None, "ac": None}


def test_set_value_preserves_whitespace_and_replaces_number():
    out = _set_value(CONFIG_SNIPPET, "IdleBacklightDimBatterySeconds", 86400)
    assert '"IdleBacklightDimBatterySeconds"    "86400"' in out
    # other key untouched
    assert '"IdleBacklightDimACSeconds"     "1800"' in out
    assert parse_dim_seconds(out) == {"battery": 86400, "ac": 1800}


# ----- read_lock_screen_settings -----

_LOCK_JSON_BLOB = r'"LockScreenSettings"	"{\"strPIN\":\"1234\",\"bLockOnWake\":false}"'
_LOCK_VDF_BLOCK = '"LockScreenSettings"\n{\n\t"strPIN"\t"1234"\n\t"bLockOnWake"\t"0"\n}'
_LOCK_ABSENT = '"SomethingElse"\t"value"'
_LOCK_EMPTY_PIN = r'"LockScreenSettings"	"{\"strPIN\":\"\",\"bLockOnWake\":false}"'


def _with_text(text: str):
    """Call read_lock_screen_settings with a fake config.vdf containing text."""
    from pathlib import Path
    fake = MagicMock(spec=Path)
    fake.is_file.return_value = True
    fake.read_text.return_value = text
    fake.__str__ = lambda self: "/fake/config.vdf"
    with patch("lib.steam_config.find_config_vdf", return_value=fake):
        return read_lock_screen_settings()


def test_lock_screen_json_blob_with_pin():
    result = _with_text(_LOCK_JSON_BLOB)
    assert result["has_pin"] is True


def test_lock_screen_json_blob_empty_pin():
    result = _with_text(_LOCK_EMPTY_PIN)
    assert result["has_pin"] is False


def test_lock_screen_vdf_block_with_pin():
    result = _with_text(_LOCK_VDF_BLOCK)
    assert result["has_pin"] is True


def test_lock_screen_absent_returns_false():
    result = _with_text(_LOCK_ABSENT)
    assert result["has_pin"] is False


def test_lock_screen_no_config_returns_false():
    with patch("lib.steam_config.find_config_vdf", return_value=None):
        result = read_lock_screen_settings()
    assert result["has_pin"] is False
    assert result["source"] is None
