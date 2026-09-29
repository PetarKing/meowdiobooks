from pathlib import Path
import json
base=Path(__file__).with_name('01-audition-contract-before-probes.py').read_text().split('with Live(voice_auditioner=success_stub) as h:')[0]
exec(compile(base,'<audit-helpers>','exec'))
from meowdiobooks.backend.storage import JsonStore
from meowdiobooks.backend.voice_retention import prune_voice_files
source_before=hashlib.sha256((REPO/'src/meowdiobooks/backend/app_v2.py').read_bytes()).hexdigest()
records=[]

publication_entered, release_publication, cancel_contending=threading.Event(),threading.Event(),threading.Event()
class ObservedStore(JsonStore):
    def update(self,item_id,change):
        if 'JobQueue.cancel' in change.__qualname__:
            cancel_contending.set()
        return super().update(item_id,change)
def retain_at_commit(package,keep):
    publication_entered.set()
    assert release_publication.wait(4)
    prune_voice_files(package,keep)
with tempfile.TemporaryDirectory(prefix='auditor01-race-store-') as directory:
    def stores(name,model):
        return ObservedStore(Path(directory)/f'{name}.json',model)
    with Live(voice_auditioner=success_stub,store_factory=stores,on_cast_voice_revisions_changed=retain_at_commit) as h:
        h.seed()
        job=h.submit()
        assert publication_entered.wait(3)
        responses=[]
        def cancel_http():
            with httpx2.Client(base_url=f'http://127.0.0.1:{h.port}',timeout=6) as client:
                response=client.post(f'/api/jobs/{job}/cancel')
                responses.append((response.status_code,response.json()))
        thread=threading.Thread(target=cancel_http)
        thread.start()
        try:
            assert cancel_contending.wait(3)
            assert thread.is_alive()
        finally:
            release_publication.set()
        thread.join(4)
        assert not thread.is_alive()
        result=h.wait(job)
        assert result['status']=='succeeded',result
        assert responses[0][0]==409,responses
        assert h.snapshot()['pendingCandidates']['cast']['revision']==result['result']['revision']
        assert h.client.get(h.url('alice','alice-4')).status_code==200
        assert h.accepted_path.read_bytes()==h.accepted_bytes
        terminal_again=h.client.post(f'/api/jobs/{job}/cancel')
        assert terminal_again.status_code==409
        assert h.wait(job)['status']=='succeeded'
        records.append({'case':'publication callback holds job-store update while TCP cancellation contends',
            'result':'pass','jobStatus':result['status'],'cancelHTTP':responses[0][0],
            'cancelDetail':responses[0][1]['detail'],'secondCancelHTTP':terminal_again.status_code,
            'pendingCandidateMatchesCommittedResult':True,'newPreviewHTTP':200,'acceptedJSONImmutable':True})

provider_started,release_provider=threading.Event(),threading.Event()
calls=[]
def slow_provider(_repo,package,book,rows,report,language,model):
    calls.append('generated')
    provider_started.set()
    assert release_provider.wait(4)
    return generated(rows,package,book)
def clone(*_):
    calls.append('clone')
    return wav(660)
old_normalize=appmod.normalize_voice_sample
reference_wav=wav(220,4)
appmod.normalize_voice_sample=lambda *_:(reference_wav,4.0)
try:
    with Live(voice_auditioner=slow_provider,voice_sample_auditioner=clone) as h:
        h.seed()
        job=h.submit()
        assert provider_started.wait(3)
        duplicate=h.client.post(f'/api/books/{h.book}/stages/cast/process',json={'settings':{
            'proposalRevision':'editable','characterId':'alice'}})
        assert duplicate.status_code==409,duplicate.text
        assert duplicate.json()['detail']['jobId']==job
        upload=h.client.post(f'/api/books/{h.book}/stages/cast/candidates/editable/voices/alice/upload',
            data={'reference_text':'Exact newly uploaded words.'},files={'file':('sample.wav',reference_wav,'audio/wav')})
        assert upload.status_code==201,upload.text
        current=upload.json()
        clone_choice=current['identities'][0]['voiceCandidates'][-1]
        release_provider.set()
        result=h.wait(job)
        assert result['status']=='failed',result
        assert 'draft changed' in result['error']
        assert calls==['generated','clone'],calls
        assert h.snapshot()['pendingCandidates']['cast']['revision']==current['revision']
        choices=current['identities'][0]['voiceCandidates']
        preview_status={r['revision']:h.client.get(r['previewUrl']).status_code for r in choices}
        assert all(code==200 for code in preview_status.values())
        assert (h.package/clone_choice['referenceAudio']).read_bytes()==reference_wav
        assert h.client.get(h.url('alice','alice-4')).status_code==404
        assert h.accepted_path.read_bytes()==h.accepted_bytes
        accepted=h.accept(current['revision'],clone_choice['revision'])
        assert accepted.status_code==200,accepted.text
        stored=read_artifact(h.package,'cast')['identities'][0]
        assert stored['referenceText']=='Exact newly uploaded words.'
        assert (h.package/stored['referenceAudio']).read_bytes()==reference_wav
        records.append({'case':'TCP upload advances draft while generated provider runs', 'result':'pass',
            'duplicateProcessHTTP':duplicate.status_code,'uploadHTTP':upload.status_code,
            'generatedJobStatus':result['status'],'generatedError':result['error'],
            'allCurrentPreviewsHTTP':preview_status,'staleGeneratedPreviewHTTP':404,
            'uploadedReferenceBytesPreserved':True,'cloneAcceptanceHTTP':accepted.status_code,
            'cloneTranscriptAndReferencePinned':True,'acceptedOldJSONImmutable':True})
finally:
    release_provider.set()
    appmod.normalize_voice_sample=old_normalize
source_after=hashlib.sha256((REPO/'src/meowdiobooks/backend/app_v2.py').read_bytes()).hexdigest()
assert source_after==source_before,'Backend source changed during probe'
out={'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    'transport':'uvicorn TCP localhost + httpx2; isolated synthetic package per case',
    'appSourceSHA256':source_after,'queueSourceSHA256':hashlib.sha256((REPO/'src/meowdiobooks/backend/queue.py').read_bytes()).hexdigest(),
    'probeSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'records':records}
print(json.dumps(out,indent=2))
Path(__file__).with_name('01-audition-contract-races-after.json').write_text(json.dumps(out,indent=2)+'\n')
