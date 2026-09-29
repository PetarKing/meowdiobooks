# Audition contract audit 01

Status: **PASS for the exercised audition publication contracts.** Both release blockers found before repair are cleared by independent real TCP HTTP probes. No remaining release blocker from audit 01. This report does not establish native decoder, paid-provider, hosted-runtime or audio-quality acceptance.

Final verified HEAD: `68fcf318be7d7f49c396d135663cbfaa8e24438d`. Backend source SHA256: `2dc9bc5961f17ef88daaf42fee25a8c458fc94cceda93a432555f01e26861e54`; queue SHA256: `5944636b899e541e4cb3a7b18b2f0bd10d011e23be00de45bf6974aa8411935d`. Backend, queue and publication protocol working bytes equal committed HEAD, with no relevant working diff. Exact fingerprints are preserved in `01-audition-contract-source.json`.

The original audit began at dirty HEAD `36e99f0fe5d76cd446e3329e200a34a1af9925ad`. Before probes completed at `9545014c8100f1e286baddc7a935c99145bffa8b`, backend SHA256 `4a3a25ad1d512ce590d522f7f70b3fad7b65248f1d1bf6686fcbc3e70c13c79c`. Initial relevant diff: backend +45/-4, finish tests +138/-8, package contract +5/-2. After probes first ran against the stable repair at HEAD `4c8038470c052e09b229c8b00648ce041933689f`; final timing probes and committed-byte verification ran at `68fcf318`. Both after runs used the same repaired backend bytes. This auditor edited evidence only and performed no Git mutation.

## Before and after

| Scenario | Before repair | Independently observed after repair |
|---|---|---|
| Running generated audition canceled before provider return | Job canceled, yet new Cast JSON became pending and fresh preview returned 200 | Job canceled; no new Cast JSON; previous pending/accepted state intact; fresh preview 404 |
| Protocol-compliant `import_voice` canceled during copy | Same candidate leak; this adapter has no progress callback | Same safe cancellation result, with no new candidate or WAV |
| Second append from a superseded editable draft | Both jobs succeeded; choices `1,2,3,4` became `1,2,3,5`; WAV 4 changed 200→404 | Second job fails before provider call; first new audition remains current and playable; stale clone/delete also return 409 |
| Provider returns metadata without WAV | Job succeeded; preview 404; acceptance returned 200 with nonexistent reference | Job fails; no new candidate; previous pending/accepted state intact |
| Provider writes WAV and raises | No new JSON, but orphan preview remained reachable (200) | Job fails; orphan preview 404; existing JSON and voices preserved |
| Clone against changed Dialogue/Review parents | Provider ran, clone published 201, later acceptance rejected 409 | Upload returns 409 before normalization/provider; no new artifact |

Before evidence: `01-audition-contract-before.json`, `01-audition-contract-stale-before.json` and their executable probes. After evidence: `01-audition-contract-after.json` and `01-audition-contract-races-after.json`, with executable probes beside them.

## Independent execution

Real HTTP used uvicorn on an ephemeral loopback TCP socket and httpx2. Each case used an isolated synthetic PDF/package and valid synthetic WAVs; no provider calls or spend. All temporary servers stopped and packages were removed.

The ten saved after scenarios passed: chronological 3→4 append; earlier candidate acceptance; unchanged original JSON/WAV bytes despite an adapter trying to rewrite old metadata; generated and imported cancellation; provider failure cleanup; missing audio; no fresh revision; empty provider output; stale upstream clone; clone failure cleanup; and stale editable append/upload/delete. All current preview URLs in the positive flow returned 200. Earlier `alice-1` remained selectable and the last accepted Cast remained authoritative until normal acceptance.

Two additional deterministic TCP timing probes passed:

- **Publication wins cancellation.** The final publication callback held the job-store update while an actual HTTP cancel request entered `ModelStore.update` and contended on the same lock. Publication completed; job remained `succeeded`; cancel returned 409, including a repeated cancel request. The pending candidate matched the committed job result, new preview returned 200 and previous accepted JSON stayed byte-identical. Independently executed queue regressions also cover an exception after successful commit without downgrading terminal success.
- **Upload advances a draft during provider work.** A generated provider blocked while clone upload advanced the editable draft (201). A duplicate process request returned 409. When the old provider returned, its job failed at publication with “draft changed.” Cleanup preserved the latest uploaded preview and exact reference bytes, all four current previews returned 200, and stale generated WAV returned 404. The clone then accepted with HTTP 200 and pinned the exact supplied transcript/reference; the previous accepted JSON stayed immutable.

Relevant independent pytest command:

```bash
.venv/bin/python -m pytest -q tests/backend/test_audition_publication.py tests/backend/test_storage_queue.py tests/backend/test_voice_candidates.py tests/backend/test_voice_retention.py tests/backend/test_voice_reuse.py tests/backend/test_cast_runtime.py tests/backend/test_app_v2_finish.py -m 'not uses_audio_decoder and not runs_models'
```

Result: **78 passed, 1 deselected in 4.51 s**. These include malformed adapters, selected-audio availability, accepted-parent staleness, recipe/model/language refresh, current Cast reuse, imported snapshots, layered references, retention and queue commit semantics. These are my executed results; broader results reported by other agents are not included in this count.

TCP rerun commands, from the repository root:

```bash
.venv/bin/python docs/matcha-next/evidence/promotion-2026-09-29/audits/01-audition-contract-after-probes.py
.venv/bin/python docs/matcha-next/evidence/promotion-2026-09-29/audits/01-audition-contract-race-probes.py
```

Loopback binding required sandbox escalation; the approved probes remained local and used only synthetic data/stubs.

## Contract distinctions and limits

- The request preserves three choices already visible in review; it does not increase every provider's automatic count. Cloud source inspection explains its three defaults: `_initial_design_target` produces two when Core supplies an extra pass, otherwise three; Core appends the extra pass. Shared voices remain one. Core local default count is a different provider policy. No count/cost policy change is required by this audit.
- Imported-snapshot recipe/model exemption is preexisting and explicitly tested. Core preserves destination snapshots marked `reusedVoiceSnapshot`; Cloud generation independently validates provider/model/recipe receipts. This needs precise documentation but is not an append regression; no imported-recipe policy change was validated here.
- Native decoder execution remains unavailable: the original clone/transcription regression failed because `.venv` lacks `mlx_audio`. HTTP clone probes used an explicit normalization stub and valid synthetic WAV bytes. Native decoding, real provider output, audio quality and paid calls were not validated.
- Cloud compatibility was inspected read-only in its sibling checkout; actual hosted execution and its database transaction implementation were not run. Hosted adapters write local preview/reference WAVs, can use `speaker-embedding`, and own receipts through the custom retention hook. Source review confirms the repair preserves those seams; local TCP evidence does not establish hosted runtime compatibility.
- TCP cancellation probes exercised single-voice generated and imported operations. Full-pack refresh/model/language behavior was exercised by the independent API regression suite and reviewed to use the shared publication boundary; no paid full-pack or full-pack TCP cancellation run is claimed.
