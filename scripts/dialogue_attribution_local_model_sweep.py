"""Evaluate a same-footprint GGUF model on the locked evaluation sample."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from scripts.dialogue_attribution_experiment import (
    _append_jsonl,
    _json_dump,
    _jsonl,
    _single_rows,
    score_variant,
)
from scripts.dialogue_attribution_full_consensus import _is_character, consensus_prediction

DEFAULT_CORPUS = Path("tmp/dialogue-attribution-experiment")
DEFAULT_OUTPUT = Path("tmp/dialogue-attribution-local-model-sweep/ministral3-8b-q4")
DEFAULT_MODEL = Path(
    ".local/models/ministral3-8b/Ministral-3-8B-Instruct-2512-Q4_K_M.gguf"
)


@contextmanager
def model_server(repo_root: Path, model: Path, port: int = 18084) -> Iterator[str]:
    runtime = repo_root / ".local/llama.cpp/b9637/llama-server"
    process = subprocess.Popen(
        [
            str(runtime),
            "-m",
            str(model),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "-c",
            "32768",
            "-ngl",
            "99",
            "--jinja",
            "--no-webui",
            "--parallel",
            "1",
            "--cache-ram",
            "0",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(240):
            try:
                urllib.request.urlopen(f"{base}/health", timeout=1).read()
                break
            except (OSError, urllib.error.URLError):
                if process.poll() is not None:
                    raise RuntimeError(f"llama-server exited with code {process.returncode}")
                time.sleep(0.5)
        else:
            raise TimeoutError("Candidate model did not become ready")
        yield base
    finally:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def _windows(corpus: Path) -> list[dict[str, Any]]:
    return list(json.loads((corpus / "corpus.json").read_text(encoding="utf-8"))["windows"])


def _run_stage(base: str, windows: list[dict[str, Any]], output: Path, variant: str, allowed=None) -> None:
    path = output / "runs" / f"{variant}.jsonl"
    completed = {str(row["sampleId"]) for row in _jsonl(path)}
    expected = {
        f"{window['bookId']}:{owner}"
        for window in windows
        for owner in window["targetIds"]
        if allowed is None or f"{window['bookId']}:{owner}" in allowed
    }
    for window in windows:
        targets = [
            str(owner)
            for owner in window["targetIds"]
            if allowed is None or f"{window['bookId']}:{owner}" in allowed
        ]
        filtered = {**window, "targetIds": targets}
        for row in _single_rows(base, variant, filtered, completed):
            _append_jsonl(path, [row])
            completed.add(str(row["sampleId"]))
            done = len(completed & expected)
            if done % 20 == 0 or done == len(expected):
                print(f"[{variant}] {done}/{len(expected)}", flush=True)


def _materialize_consensus(corpus: Path, output: Path) -> None:
    base_rows = {str(row["sampleId"]): row for row in _jsonl(output / "runs/v0-control.jsonl")}
    verifier_rows = {
        str(row["sampleId"]): row for row in _jsonl(output / "runs/v2-conversation.jsonl")
    }
    rows = []
    for sample_id, base in base_rows.items():
        row = dict(base)
        row["variant"] = "consensus"
        row["callId"] = f"consensus:{sample_id}"
        row["prediction"] = consensus_prediction(base, verifier_rows.get(sample_id))
        row["raw"] = row["prediction"]
        row["parseError"] = None if row["prediction"] is not None else "upstream parse failure"
        rows.append(row)
    path = output / "runs/consensus.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    # score_variant needs the locked labels colocated with the candidate runs.
    (output / "gold.jsonl").write_text((corpus / "gold.jsonl").read_text(encoding="utf-8"), encoding="utf-8")


def _normal(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def false_character_metrics(output: Path, variant: str) -> dict[str, Any]:
    gold = {str(row["sampleId"]): row for row in _jsonl(output / "gold.jsonl")}
    rows = {str(row["sampleId"]): row for row in _jsonl(output / "runs" / f"{variant}.jsonl")}
    assignments = correct = 0
    for sample_id, row in rows.items():
        prediction = row.get("prediction")
        if not _is_character(prediction):
            continue
        assignments += 1
        expected = gold[sample_id]
        accepted = {
            _normal(expected.get("canonicalSpeaker")),
            *(_normal(alias) for alias in expected.get("acceptedAliases", [])),
        }
        if (
            expected.get("classification") == "dialogue"
            and expected.get("speakerInferable")
            and _normal(prediction) in accepted
        ):
            correct += 1
    false = assignments - correct
    return {
        "characterAssignments": assignments,
        "correctCharacterAssignments": correct,
        "falseCharacterAssignments": false,
        "characterPrecision": correct / max(1, assignments),
        "falseCharacterRate": false / max(1, assignments),
    }


def run(repo_root: Path, corpus: Path, output: Path, model: Path) -> None:
    windows = _windows(corpus)
    with model_server(repo_root, model) as base:
        _run_stage(base, windows, output, "v0-control")
        base_rows = {
            str(row["sampleId"]): row for row in _jsonl(output / "runs/v0-control.jsonl")
        }
        proposals = {
            sample_id for sample_id, row in base_rows.items() if _is_character(row.get("prediction"))
        }
        print(f"[v2-conversation] checking {len(proposals)} Character proposals", flush=True)
        _run_stage(base, windows, output, "v2-conversation", proposals)
    _materialize_consensus(corpus, output)
    results = []
    for variant in ("v0-control", "consensus"):
        result = score_variant(output, variant)
        result["falseCharacter"] = false_character_metrics(output, variant)
        if variant == "consensus":
            verifier_rows = _jsonl(output / "runs/v2-conversation.jsonl")
            verifier_latency = sum(int(row.get("latencyMs", 0)) for row in verifier_rows)
            result["selectiveVerifier"] = {
                "physicalCalls": len(verifier_rows),
                "addedLatencyMs": verifier_latency,
                "combinedLatencyMs": int(result["latencyMs"]["total"]) + verifier_latency,
            }
        results.append(result)
    _json_dump(output / "scores.json", results)
    print(json.dumps(results, indent=2), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    corpus = args.corpus if args.corpus.is_absolute() else repo_root / args.corpus
    output = args.output if args.output.is_absolute() else repo_root / args.output
    model = args.model if args.model.is_absolute() else repo_root / args.model
    run(repo_root, corpus, output, model)


if __name__ == "__main__":
    main()
