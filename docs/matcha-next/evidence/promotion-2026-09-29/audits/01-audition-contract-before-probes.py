from __future__ import annotations
import hashlib, json, runpy, socket, subprocess, tempfile, threading, time
from copy import deepcopy
from io import BytesIO
from pathlib import Path
import httpx2
import numpy as np
import uvicorn
from scipy.io import wavfile
from meowdiobooks.backend.app_v2 import create_app_v2
import meowdiobooks.backend.app_v2 as appmod
from meowdiobooks.backend.artifacts import read_artifact, write_artifact
from meowdiobooks.backend.cast_service import default_voice_settings

REPO = Path.cwd()
helpers = runpy.run_path(str(REPO / 'tests/backend/test_app_v2_finish.py'))
pdf, seed_review = helpers['_pdf'], helpers['_seed_reviewed_transcript']
records = []

def wav(freq=440, seconds=0.1):
    data = BytesIO()
    x = np.arange(int(24000 * seconds), dtype=np.float32) / 24000
    wavfile.write(data, 24000, (0.1 * np.sin(2 * np.pi * freq * x)).astype(np.float32))
    return data.getvalue()

class Live:
    def __init__(self, **kw):
        self.tmp = tempfile.TemporaryDirectory(prefix='auditor01-')
        self.root = Path(self.tmp.name)
        app = create_app_v2(self.root, default_voice_model='test',
            voice_models=lambda *_: [{'id': 'test', 'recipeVersion': '1'}],
            voice_languages=lambda *_: ['english', 'french'], **kw)
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        self.port = sock.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
        self.thread = threading.Thread(target=lambda: self.server.run(sockets=[sock]), daemon=True)
        self.thread.start()
        deadline = time.monotonic() + 5
        while not self.server.started and time.monotonic() < deadline:
            time.sleep(.01)
        assert self.server.started
        self.client = httpx2.Client(base_url=f'http://127.0.0.1:{self.port}', timeout=8)
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.client.close()
        self.server.should_exit = True
        self.thread.join(5)
        assert not self.thread.is_alive()
        self.tmp.cleanup()
    def seed(self):
        r = self.client.post('/api/books/import', files={'file': ('book.pdf', pdf(), 'application/pdf')})
        assert r.status_code == 201, r.text
        self.book = r.json()['book']['id']
        self.package, dialogue, review = seed_review(self.root, self.book)
        voices = []
        for cid in ('narrator', 'alice'):
            candidates = []
            for n in (1, 2, 3):
                rev = f'{cid}-{n}'
                rel = f'voices/{cid}/{rev}.wav'
                path = self.package / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(wav(n * 220))
                candidates.append({'revision': rev, 'previewUrl': self.url(cid, rev),
                    'referenceAudio': rel, 'referenceText': 'Original synthetic words.',
                    'direction': f'Direction {n}', 'voiceSettings': default_voice_settings('character')})
            voices.append({'characterId': cid, 'name': cid.title(),
                'category': 'narrator' if cid == 'narrator' else 'character',
                'lineCount': 0 if cid == 'narrator' else 1,
                'literalLabels': [] if cid == 'narrator' else ['Alice'],
                'voiceCandidates': candidates, 'voiceCandidatePlan': {'automaticAlternatives': 2},
                'voicePreviewRevision': candidates[0]['revision'], 'previewUrl': candidates[0]['previewUrl'],
                'referenceText': candidates[0]['referenceText'], 'referenceAudio': candidates[0]['referenceAudio'],
                'voiceSettings': default_voice_settings('character'), 'voiceAccepted': True,
                'acceptedVoiceRevision': candidates[0]['revision']})
        payload = {'revision': 'accepted-before', 'phase': 'accepted', 'status': 'accepted',
            'dialogueRevision': dialogue['revision'], 'reviewRevision': review['revision'],
            'language': 'english', 'voiceModel': 'test', 'auditionPackRecipeVersion': '1',
            'labelToCharacterId': {'Alice': 'alice'}, 'narrator': voices[0], 'identities': [voices[1]]}
        self.accepted_path, self.accepted = write_artifact(self.package, 'cast', payload)
        self.accepted_bytes = self.accepted_path.read_bytes()
        _, self.draft = write_artifact(self.package, 'cast', {**self.accepted,
            'revision': 'editable', 'phase': 'audition-review'}, publish=False)
        return self.draft
    def url(self, cid, rev):
        return f'/api/books/{self.book}/voices/{cid}/{rev}/audio'
    def submit(self, **extra):
        r = self.client.post(f'/api/books/{self.book}/stages/cast/process',
            json={'settings': {'proposalRevision': 'editable', 'characterId': 'alice', **extra}})
        assert r.status_code == 202, r.text
        return r.json()['id']
    def wait(self, job):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            r = self.client.get(f'/api/jobs/{job}').json()
            if r['status'] in ('succeeded', 'failed', 'canceled'):
                return r
            time.sleep(.01)
        raise AssertionError('No terminal job state')
    def candidate(self, rev):
        return self.client.get(f'/api/books/{self.book}/stages/cast/candidates/{rev}').json()
    def snapshot(self):
        return self.client.get(f'/api/books/{self.book}/snapshot').json()
    def accept(self, revision, voice_revision='alice-4'):
        return self.client.post(f'/api/books/{self.book}/stages/cast/accept', json={'revision': revision,
            'decisions': [{'characterId': 'narrator', 'voiceRevision': 'narrator-1'},
                          {'characterId': 'alice', 'voiceRevision': voice_revision}]})


def generated(rows, package, book, write=True, rewrite=False):
    row = deepcopy(rows[0])
    cid, rev = row['id'], 'alice-4'
    url = f'/api/books/{book}/voices/{cid}/{rev}/audio'
    rel = f'voices/{cid}/{rev}.wav'
    if write:
        (package / rel).write_bytes(wav(880))
    candidate = {'revision': rev, 'previewUrl': url, 'referenceAudio': rel,
        'referenceText': 'New synthetic words.', 'direction': 'New direction.'}
    old = deepcopy(row['voiceCandidates'])
    if rewrite:
        old[0]['direction'] = 'Attempted metadata overwrite.'
    row.update(voicePreviewRevision=rev, previewUrl=url, referenceAudio=rel,
        referenceText='New synthetic words.', voice='New direction.', voiceCandidates=old+[candidate])
    return [row]


def success_stub(_repo, package, book, rows, report, language, model):
    return generated(rows, package, book, rewrite=True)

with Live(voice_auditioner=success_stub) as h:
    h.seed()
    old = deepcopy(h.draft['identities'][0]['voiceCandidates'])
    old_audio = {c['revision']: (h.package / c['referenceAudio']).read_bytes() for c in old}
    result = h.wait(h.submit())
    assert result['status'] == 'succeeded'
    cand = h.candidate(result['result']['revision'])
    choices = cand['identities'][0]['voiceCandidates']
    assert choices[:-1] == old and choices[-1]['parentRevision'] == 'alice-3'
    http = {c['revision']: h.client.get(c['previewUrl']).status_code for c in choices}
    assert all(code == 200 for code in http.values())
    assert h.accept(cand['revision'], 'alice-1').status_code == 200
    assert h.accepted_path.read_bytes() == h.accepted_bytes
    assert all((h.package / f'voices/alice/{r}.wav').read_bytes() == b for r,b in old_audio.items())
    records.append({'case': 'chronological append + old selection + immutable bytes', 'job': result['status'],
        'choices': [c['revision'] for c in choices], 'previewHTTP': http, 'acceptEarlierHTTP': 200})

started, release = threading.Event(), threading.Event()
def cancel_stub(_repo, package, book, rows, report, language, model):
    started.set()
    assert release.wait(4)
    return generated(rows, package, book)
with Live(voice_auditioner=cancel_stub) as h:
    h.seed()
    before = {p.name for p in (h.package / 'artifacts/cast').glob('*.json')}
    job = h.submit()
    assert started.wait(3)
    cancel = h.client.post(f'/api/jobs/{job}/cancel')
    release.set()
    result = h.wait(job)
    after = {p.name for p in (h.package / 'artifacts/cast').glob('*.json')}
    snap = h.snapshot()
    assert h.accepted_path.read_bytes() == h.accepted_bytes
    records.append({'case': 'running cancel before provider return', 'job': result['status'],
        'cancelHTTP': cancel.status_code, 'newCastJSON': sorted(after-before),
        'pendingCast': snap['pendingCandidates']['cast']['revision'],
        'activeCast': snap['activeArtifacts']['cast'], 'newPreviewHTTP': h.client.get(h.url('alice','alice-4')).status_code})

def fail_stub(_repo, package, book, rows, report, language, model):
    generated(rows, package, book)
    raise RuntimeError('Synthetic failure after writing WAV')
with Live(voice_auditioner=fail_stub) as h:
    h.seed()
    result = h.wait(h.submit())
    assert result['status'] == 'failed'
    assert h.accepted_path.read_bytes() == h.accepted_bytes
    records.append({'case': 'provider raises after writing WAV', 'job': result['status'],
        'castJSONCount': len(list((h.package / 'artifacts/cast').glob('*.json'))),
        'pendingCast': h.snapshot()['pendingCandidates']['cast']['revision'],
        'orphanPreviewHTTP': h.client.get(h.url('alice','alice-4')).status_code})

def no_audio_stub(_repo, package, book, rows, report, language, model):
    return generated(rows, package, book, write=False)
with Live(voice_auditioner=no_audio_stub) as h:
    h.seed()
    result = h.wait(h.submit())
    cand = h.candidate(result['result']['revision'])
    preview = h.client.get(h.url('alice','alice-4'))
    accept = h.accept(cand['revision'])
    records.append({'case': 'adapter returns complete metadata without WAV', 'job': result['status'],
        'previewHTTP': preview.status_code, 'acceptHTTP': accept.status_code,
        'acceptedReferenceExists': (h.package / read_artifact(h.package,'cast')['identities'][0]['referenceAudio']).is_file()})

import_started, import_release = threading.Event(), threading.Event()
class BlockingReuse:
    def import_voice(self, _book, package, target, source, language, model):
        import_started.set()
        assert import_release.wait(4)
        cid, rev = target['characterId'], 'alice-imported'
        rel = f'voices/{cid}/{rev}.wav'
        (package/rel).write_bytes(wav(880))
        candidate = {'revision':rev, 'previewUrl':f'/api/books/{_book}/voices/{cid}/{rev}/audio',
            'referenceAudio':rel, 'referenceText':'Imported synthetic words.', 'direction':'Imported direction.'}
        return {**target, 'voicePreviewRevision':rev, 'previewUrl':candidate['previewUrl'],
            'referenceAudio':rel, 'referenceText':candidate['referenceText'], 'voiceCandidates':[candidate]}
with Live(cast_voice_reuse=BlockingReuse()) as h:
    h.seed()
    before = {p.name for p in (h.package/'artifacts/cast').glob('*.json')}
    job = h.submit(sourceVoice={'bookId':'source', 'characterId':'source-alice', 'revision':'source-rev'})
    assert import_started.wait(3)
    cancel = h.client.post(f'/api/jobs/{job}/cancel')
    import_release.set()
    result = h.wait(job)
    after = {p.name for p in (h.package/'artifacts/cast').glob('*.json')}
    records.append({'case':'running cancel during protocol-compliant import_voice',
        'job':result['status'], 'cancelHTTP':cancel.status_code, 'newCastJSON':sorted(after-before),
        'pendingCast':h.snapshot()['pendingCandidates']['cast']['revision'],
        'newPreviewHTTP':h.client.get(h.url('alice','alice-imported')).status_code})

old_normalize = appmod.normalize_voice_sample
appmod.normalize_voice_sample = lambda raw, name: (wav(seconds=4), 4.0)
try:
    with Live(voice_sample_auditioner=lambda *_: wav()) as h:
        h.seed()
        prior = read_artifact(h.package, 'review')
        write_artifact(h.package, 'review', {**prior, 'revision': 'review-changed'})
        stale = h.client.post(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/upload',
            data={'reference_text':'Exact sample transcript.'}, files={'file':('sample.wav', wav(seconds=4), 'audio/wav')})
        assert stale.status_code == 201, stale.text
        cloned = stale.json()['identities'][0]['voiceCandidates'][-1]
        rejected = h.accept(stale.json()['revision'], cloned['revision'])
        records.append({'case': 'clone stale upstream draft', 'cloneHTTP': stale.status_code,
            'clonePreviewHTTP':h.client.get(cloned['previewUrl']).status_code,
            'acceptHTTP':rejected.status_code, 'acceptDetail':rejected.json()['detail'],
            'newCastJSONCount':len(list((h.package / 'artifacts/cast').glob('*.json')))})
    def clone_fail(*_):
        raise RuntimeError('Synthetic clone failure')
    with Live(voice_sample_auditioner=clone_fail) as h:
        h.seed()
        before = sorted(str(p.relative_to(h.package)) for p in (h.package/'voices').rglob('*.wav'))
        failed = h.client.post(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/upload',
            data={'reference_text':'Exact sample transcript.'}, files={'file':('sample.wav', wav(seconds=4), 'audio/wav')})
        after = sorted(str(p.relative_to(h.package)) for p in (h.package/'voices').rglob('*.wav'))
        assert before == after
        records.append({'case':'clone provider failure cleanup', 'cloneHTTP':failed.status_code,
            'voiceFilesUnchanged':before==after, 'castJSONCount':len(list((h.package/'artifacts/cast').glob('*.json')))})
finally:
    appmod.normalize_voice_sample = old_normalize

out = {'head':subprocess.check_output(['git','rev-parse','HEAD'], text=True).strip(),
    'transport':'uvicorn TCP localhost + httpx2; isolated synthetic package per case',
    'appSourceSHA256':hashlib.sha256((REPO/'src/meowdiobooks/backend/app_v2.py').read_bytes()).hexdigest(),
    'probeSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'records':records}
print(json.dumps(out, indent=2))
if len(__import__('sys').argv) > 1:
    Path(__import__('sys').argv[1]).write_text(json.dumps(out,indent=2)+'\n')
