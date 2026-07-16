from scripts.dialogue_attribution_full_consensus import consensus_prediction


def _row(prediction, accepted=True):
    return {"prediction": prediction, "validatorAccepted": accepted}


def test_consensus_preserves_non_character_base_decisions_without_verifier():
    assert consensus_prediction(_row("?"), None) == "?"
    assert consensus_prediction(_row("/"), None) == "/"
    assert consensus_prediction({"prediction": None}, None) is None


def test_consensus_requires_normalized_exact_character_agreement():
    assert consensus_prediction(_row("Lord Henry"), _row(" lord   henry ")) == "Lord Henry"
    assert consensus_prediction(_row("Lord Henry"), _row("Basil")) == "?"
    assert consensus_prediction(_row("Lord Henry"), _row("?")) == "?"


def test_consensus_requires_both_existing_evidence_validators():
    assert consensus_prediction(_row("Lord Henry", False), _row("Lord Henry")) == "?"
    assert consensus_prediction(_row("Lord Henry"), _row("Lord Henry", False)) == "?"
