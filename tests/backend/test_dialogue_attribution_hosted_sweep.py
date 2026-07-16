from scripts.dialogue_attribution_hosted_sweep import (
    load_dotenv,
    ordered_window_prompt,
    parse_multi_rows,
)


def test_load_dotenv_preserves_existing_values_and_unquotes(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text('EXISTING="new"\nNEW_VALUE=\'hello\'\n# ignored\n', encoding="utf-8")
    monkeypatch.setenv("EXISTING", "old")
    monkeypatch.delenv("NEW_VALUE", raising=False)

    load_dotenv(path)

    assert __import__("os").environ["EXISTING"] == "old"
    assert __import__("os").environ["NEW_VALUE"] == "hello"


def test_parse_multi_rows_enforces_order_and_contract():
    assert parse_multi_rows("T001|D|Subaru\nT002|D|?\nT003|N", ["T001", "T002", "T003"]) == {
        "T001": "Subaru",
        "T002": "?",
        "T003": "/",
    }


def test_ordered_window_prompt_marks_targets_without_source_ids():
    window = {
        "partition": [
            {"id": "s1", "source": "Before. "},
            {"id": "s2", "source": '"Hello."', "turnGroupId": "g1"},
            {"id": "s3", "source": " After."},
        ]
    }
    prompt, mapping, source = ordered_window_prompt(window, ["s2"])
    assert mapping == {"T001": "s2"}
    assert "[T001]\n\"Hello.\"\n[/T001]" in prompt
    assert "s2" not in prompt
    assert source in prompt
