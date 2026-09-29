from pathlib import Path
import json
base = Path(__file__).with_name('01-audition-contract-before-probes.py').read_text().split('with Live(voice_auditioner=success_stub) as h:')[0]
exec(compile(base, '<audit-helpers>', 'exec'))
records = []

def unchanged(h):
    assert h.accepted_path.read_bytes() == h.accepted_bytes
    assert h.snapshot()['activeArtifacts']['cast'] == 'accepted-before'

def no_new_candidate(h, before):
    after = {p.name for p in (h.package/'artifacts/cast').glob('*.json')}
    assert after == before
    assert h.snapshot()['pendingCandidates']['cast']['revision'] == 'editable'
    unchanged(h)

with Live(voice_auditioner=success_stub) as h:
    h.seed()
    old = deepcopy(h.draft['identities'][0]['voiceCandidates'])
    old_audio = {c['revision']:(h.package/c['referenceAudio']).read_bytes() for c in old}
    result = h.wait(h.submit())
    assert result['status'] == 'succeeded', result
    cand = h.candidate(result['result']['revision'])
    choices = cand['identities'][0]['voiceCandidates']
    assert choices[:-1] == old and choices[-1]['parentRevision'] == 'alice-3'
    assert all(h.client.get(c['previewUrl']).status_code == 200 for c in choices)
    assert h.accept(cand['revision'], 'alice-1').status_code == 200
    assert h.accepted_path.read_bytes() == h.accepted_bytes
    assert all((h.package/f'voices/alice/{r}.wav').read_bytes()==b for r,b in old_audio.items())
    records.append({'case':'append3→4, old selection, immutable JSON/audio', 'result':'pass'})

for reuse in (False, True):
    started, release = threading.Event(), threading.Event()
    def cancel_stub(_repo, package, book, rows, report, language, model):
        started.set()
        assert release.wait(4)
        return generated(rows, package, book)
    class BlockingReuse:
        def import_voice(self, book, package, target, source, language, model):
            started.set()
            assert release.wait(4)
            rel = 'voices/alice/alice-imported.wav'
            (package/rel).write_bytes(wav(880))
            cand = {'revision':'alice-imported', 'referenceAudio':rel,
                'previewUrl':f'/api/books/{book}/voices/alice/alice-imported/audio',
                'referenceText':'Imported synthetic words.'}
            return {**target, 'voicePreviewRevision':cand['revision'], 'referenceAudio':rel,
                'previewUrl':cand['previewUrl'], 'referenceText':cand['referenceText'], 'voiceCandidates':[cand]}
    kwargs = {'cast_voice_reuse':BlockingReuse()} if reuse else {'voice_auditioner':cancel_stub}
    with Live(**kwargs) as h:
        h.seed()
        before = {p.name for p in (h.package/'artifacts/cast').glob('*.json')}
        extra = {'sourceVoice':{'bookId':'source', 'characterId':'source-alice', 'revision':'source-rev'}} if reuse else {}
        job = h.submit(**extra)
        assert started.wait(3)
        assert h.client.post(f'/api/jobs/{job}/cancel').status_code == 200
        release.set()
        result = h.wait(job)
        assert result['status'] == 'canceled', result
        no_new_candidate(h,before)
        newrev = 'alice-imported' if reuse else 'alice-4'
        assert h.client.get(h.url('alice',newrev)).status_code == 404
        records.append({'case':'running cancellation '+('import adapter' if reuse else 'generated adapter'), 'result':'pass'})

for mode in ('raises-after-WAV', 'metadata-without-WAV', 'no-new-revision', 'empty-provider-result'):
    def failure_stub(_repo, package, book, rows, report, language, model):
        if mode == 'no-new-revision':
            row = deepcopy(rows[0])
            row.update(voicePreviewRevision='alice-1', referenceAudio='voices/alice/alice-1.wav',
                referenceText='Original synthetic words.', previewUrl=f'/api/books/{book}/voices/alice/alice-1/audio')
            return [row]
        result = generated(rows,package,book,write=mode!='metadata-without-WAV')
        if mode == 'raises-after-WAV':
            raise RuntimeError('Synthetic failure after writing WAV')
        return [] if mode == 'empty-provider-result' else result
    with Live(voice_auditioner=failure_stub) as h:
        h.seed()
        before = {p.name for p in (h.package/'artifacts/cast').glob('*.json')}
        result = h.wait(h.submit())
        assert result['status'] == 'failed', result
        no_new_candidate(h,before)
        assert h.client.get(h.url('alice','alice-4')).status_code == 404
        records.append({'case':mode, 'result':'pass', 'error':result['error']})

old_normalize = appmod.normalize_voice_sample
clone_calls = [0]
def clone(*_):
    clone_calls[0] += 1
    return wav()
appmod.normalize_voice_sample = lambda raw,name:(wav(seconds=4),4.0)
try:
    with Live(voice_sample_auditioner=clone) as h:
        h.seed()
        prior=read_artifact(h.package,'review')
        write_artifact(h.package,'review',{**prior,'revision':'review-changed'})
        response=h.client.post(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/upload',
            data={'reference_text':'Exact synthetic words.'},files={'file':('sample.wav',wav(seconds=4),'audio/wav')})
        assert response.status_code==409, response.text
        assert clone_calls[0]==0
        assert len(list((h.package/'artifacts/cast').glob('*.json')))==2
        assert h.accepted_path.read_bytes()==h.accepted_bytes
        records.append({'case':'clone stale upstream draft before provider', 'result':'pass'})
    def clone_failure(*_):
        raise RuntimeError('Synthetic clone failure')
    with Live(voice_sample_auditioner=clone_failure) as h:
        h.seed()
        before={p.name for p in (h.package/'artifacts/cast').glob('*.json')}
        wavbefore=sorted(str(p.relative_to(h.package)) for p in (h.package/'voices').rglob('*.wav'))
        response=h.client.post(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/upload',
            data={'reference_text':'Exact synthetic words.'},files={'file':('sample.wav',wav(seconds=4),'audio/wav')})
        assert response.status_code==422
        assert wavbefore==sorted(str(p.relative_to(h.package)) for p in (h.package/'voices').rglob('*.wav'))
        no_new_candidate(h,before)
        records.append({'case':'clone failure cleanup', 'result':'pass'})
finally:
    appmod.normalize_voice_sample=old_normalize

calls=[3]
def two_tab_stub(_repo,package,book,rows,report,language,model):
    calls[0]+=1
    rev=f'alice-{calls[0]}'
    row=deepcopy(rows[0])
    rel=f'voices/alice/{rev}.wav'
    (package/rel).write_bytes(wav(220*calls[0]))
    cand={'revision':rev,'referenceAudio':rel,'previewUrl':f'/api/books/{book}/voices/alice/{rev}/audio',
          'referenceText':'Fresh synthetic words.'}
    row.update(voicePreviewRevision=rev,referenceAudio=rel,previewUrl=cand['previewUrl'],
               referenceText=cand['referenceText'],voiceCandidates=[cand])
    return [row]
with Live(voice_auditioner=two_tab_stub,voice_sample_auditioner=clone) as h:
    h.seed()
    first=h.wait(h.submit())
    assert first['status']=='succeeded', first
    firstrev=first['result']['revision']
    firstchoices=h.candidate(firstrev)['identities'][0]['voiceCandidates']
    second=h.wait(h.submit())
    assert second['status']=='failed', second
    assert calls[0]==4
    assert h.snapshot()['pendingCandidates']['cast']['revision']==firstrev
    assert h.client.get(h.url('alice','alice-4')).status_code==200
    assert h.candidate(firstrev)['identities'][0]['voiceCandidates']==firstchoices
    assert len(list((h.package/'artifacts/cast').glob('*.json')))==3
    old_calls=clone_calls[0]
    response=h.client.post(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/upload',
        data={'reference_text':'Exact synthetic words.'},files={'file':('sample.wav',wav(seconds=4),'audio/wav')})
    assert response.status_code==409, response.text
    assert clone_calls[0]==old_calls
    deletion=h.client.delete(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/alice-1')
    assert deletion.status_code==409, deletion.text
    unchanged(h)
    records.append({'case':'stale editable append/upload/delete keep latest current choices', 'result':'pass',
        'appendJob':second['status'], 'uploadHTTP':response.status_code, 'deleteHTTP':deletion.status_code})

out={'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    'transport':'uvicorn TCP localhost + httpx2; isolated synthetic package per case',
    'appSourceSHA256':hashlib.sha256((REPO/'src/meowdiobooks/backend/app_v2.py').read_bytes()).hexdigest(),
    'probeSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'records':records}
print(json.dumps(out,indent=2))
Path(__file__).with_name('01-audition-contract-after.json').write_text(json.dumps(out,indent=2)+'\n')
