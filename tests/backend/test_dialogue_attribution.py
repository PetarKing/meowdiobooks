import pytest

from meowdiobooks.backend.dialogue_attribution import supported_consensus


@pytest.mark.parametrize(
    ("first", "second", "context", "expected"),
    [
        ("Cecilus", "Cecilus Segmunt", "Cecilus Segmunt entered.", "Cecilus Segmunt"),
        ("Emilia", "Lady Emilia", "Lady Emilia replied.", "Lady Emilia"),
        ("Smith", "John Smith", "John Smith waited.", "John Smith"),
        ("Subaru", "Subaro", "Subaru corrected Subaro.", "Subaru"),
        (
            "Cecilus Segmunt",
            "Cecilus Segmnut",
            "Cecilus Segmunt was printed once as Cecilus Segmnut.",
            "Cecilus Segmunt",
        ),
    ],
)
def test_supported_consensus_collates_conservative_name_variants(
    first, second, context, expected
):
    assert supported_consensus(first, second, context, "span-1") == expected


@pytest.mark.parametrize(
    ("first", "second", "context"),
    [
        ("Alice", "Bob", "Alice and Bob waited."),
        ("Ann", "Anna", "Ann met Anna."),
        ("Subaru", "Subaro", "Only Subaru appears here."),
    ],
)
def test_supported_consensus_withholds_unrelated_short_or_unsupported_names(
    first, second, context
):
    assert supported_consensus(first, second, context, "span-1") == "?"
