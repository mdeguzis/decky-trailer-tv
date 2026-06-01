from lib.settings import DEFAULT_SETTINGS, load_settings, save_settings


def test_load_returns_defaults_when_missing(tmp_path):
    assert load_settings(tmp_path / "nope.json") == DEFAULT_SETTINGS


def test_save_then_load_merges_partial_over_defaults(tmp_path):
    path = tmp_path / "settings.json"
    save_settings(path, {"source": "random", "audio": True})
    loaded = load_settings(path)
    assert loaded["source"] == "random"
    assert loaded["audio"] is True
    assert loaded["idleSeconds"] == DEFAULT_SETTINGS["idleSeconds"]


def test_save_ignores_unknown_keys(tmp_path):
    path = tmp_path / "settings.json"
    save_settings(path, {"bogus": 1, "source": "latest"})
    loaded = load_settings(path)
    assert "bogus" not in loaded
    assert loaded["source"] == "latest"
