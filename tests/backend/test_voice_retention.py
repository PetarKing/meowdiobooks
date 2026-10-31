from meowdiobooks.backend.voice_retention import cast_voice_revisions, prune_voice_files


def test_cast_voice_revisions_collects_current_candidates_and_selections():
    cast = {
        "narrator": {
            "voicePreviewRevision": "narrator-preview",
            "acceptedVoiceRevision": "narrator-selected",
            "voiceCandidates": [{"revision": "narrator-alternative"}],
        },
        "identities": [
            {
                "voiceRevision": "alice-selected",
                "voiceCandidates": [{"revision": "alice-selected"}],
            }
        ],
    }

    assert cast_voice_revisions(cast) == frozenset(
        {
            "narrator-preview",
            "narrator-selected",
            "narrator-alternative",
            "alice-selected",
        }
    )


def test_prune_voice_files_keeps_only_reachable_revision_audio(tmp_path):
    voices = tmp_path / "voices" / "narrator"
    voices.mkdir(parents=True)
    (voices / "keep.wav").write_bytes(b"preview")
    (voices / "keep.reference.wav").write_bytes(b"reference")
    (voices / "old.wav").write_bytes(b"old-preview")
    (voices / "old.reference.wav").write_bytes(b"old-reference")
    (tmp_path / "voices" / "provider-index.json").write_text("{}")

    prune_voice_files(tmp_path, frozenset({"keep"}))

    assert (voices / "keep.wav").read_bytes() == b"preview"
    assert (voices / "keep.reference.wav").read_bytes() == b"reference"
    assert not (voices / "old.wav").exists()
    assert not (voices / "old.reference.wav").exists()
    assert (tmp_path / "voices" / "provider-index.json").is_file()
