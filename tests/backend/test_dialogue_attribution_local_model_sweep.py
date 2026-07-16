from scripts.dialogue_attribution_local_model_sweep import _normal


def test_local_sweep_normalizes_whitespace_and_case():
    assert _normal(" Lord   Henry ") == "lord henry"
