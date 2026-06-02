from lib.steam_config import parse_dim_seconds, _set_value

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
