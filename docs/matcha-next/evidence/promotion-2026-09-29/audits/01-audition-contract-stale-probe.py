from pathlib import Path
import json
base = Path(__file__).with_name('01-audition-contract-before-probes.py').read_text().split('with Live(voice_auditioner=success_stub) as h:')[0]
exec(compile(base, '<audit-helpers>', 'exec'))
count = [3]
def audition(_repo, package, book, rows, report, language, model):
    count[0] += 1
    row = deepcopy(rows[0])
    cid, rev = row['id'], f"alice-{count[0]}"
    rel = f'voices/{cid}/{rev}.wav'
    (package/rel).write_bytes(wav(220*count[0]))
    url = f'/api/books/{book}/voices/{cid}/{rev}/audio'
    fresh = {'revision':rev, 'referenceAudio':rel, 'previewUrl':url, 'referenceText':'Fresh synthetic words.'}
    row.update(voicePreviewRevision=rev, referenceAudio=rel, previewUrl=url,
               referenceText=fresh['referenceText'], voiceCandidates=[fresh])
    return [row]
with Live(voice_auditioner=audition) as h:
    h.seed()
    first = h.wait(h.submit())
    firstrev = first['result']['revision']
    firstbytes = (h.package/'artifacts/cast'/f'{firstrev}.json').read_bytes()
    firstchoices = h.candidate(firstrev)['identities'][0]['voiceCandidates']
    before = h.client.get(h.url('alice','alice-4')).status_code
    second = h.wait(h.submit()) # Deliberately reuses stale `editable` proposal from another open tab.
    secondchoices = h.candidate(second['result']['revision'])['identities'][0]['voiceCandidates']
    out = {'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
        'appSourceSHA256':hashlib.sha256((REPO/'src/meowdiobooks/backend/app_v2.py').read_bytes()).hexdigest(),
        'case':'append request from stale editable proposal after another successful append',
        'jobs':[first['status'],second['status']], 'firstChoices':[r['revision'] for r in firstchoices],
        'secondChoices':[r['revision'] for r in secondchoices], 'firstNewPreviewBeforeHTTP':before,
        'firstNewPreviewAfterHTTP':h.client.get(h.url('alice','alice-4')).status_code,
        'firstJSONImmutable':firstbytes==(h.package/'artifacts/cast'/f'{firstrev}.json').read_bytes(),
        'activeCast':h.snapshot()['activeArtifacts']['cast'], 'pendingCast':h.snapshot()['pendingCandidates']['cast']['revision']}
    print(json.dumps(out,indent=2))
    Path('/private/tmp/auditor01-stale-results.json').write_text(json.dumps(out,indent=2)+'\n')
