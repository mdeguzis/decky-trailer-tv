from lib.steam_config import parse_dim_seconds

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
