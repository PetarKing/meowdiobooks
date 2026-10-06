from copy import deepcopy
import importlib.util,json,pathlib,subprocess,tempfile,types
from pypdf import PdfReader
from meowdiobooks.backend.generation_status import chapter_audio_stale_reasons
root=pathlib.Path.cwd()
base_commit='f136421bcf5bdbe8a68ef3f73de95836e6f6302e'
spec=importlib.util.spec_from_file_location('recipe_tests',root/'tests/backend/test_generation_status.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
baseline=types.ModuleType('meowdiobooks.backend.generation_status_baseline');baseline.__package__='meowdiobooks.backend'
exec(subprocess.check_output(['git','show',base_commit+':src/meowdiobooks/backend/generation_status.py'],text=True),baseline.__dict__)
results=[]
for pdf in sorted((root/'SampleBooks/public-domain-evaluation').glob('*.pdf')):
 text='\n'.join(p.extract_text() or '' for p in PdfReader(pdf).pages)
 middle=len(text)//2
 inputs=helper._inputs()
 for span,passage in zip(inputs['dialogue']['spans'],[text[:middle],text[middle:]],strict=True):
  span['source']=span['text']=passage;span['sourceEnd']=len(passage)
 for case in ['equivalent-reaccept','other-chapter-text','other-chapter-voice','used-reference-mode']:
  with tempfile.TemporaryDirectory(prefix='recipe-pd-') as package:
   package=pathlib.Path(package);pinned=helper._publish(package,inputs,'old');changed=deepcopy(inputs)
   if case=='other-chapter-text':
    span=changed['dialogue']['spans'][1];span['source']=span['text']=span['text']+' An added sentence.';span['sourceEnd']=len(span['source'])
   elif case=='other-chapter-voice':changed['cast']['identities'][1]['acceptedVoiceRevision']='new-bob'
   elif case=='used-reference-mode':changed['cast']['identities'][0]['referenceMode']='speaker-embedding'
   current=helper._publish(package,changed,'new');metadata=helper._metadata(pinned)
   before=bool(baseline.chapter_audio_stale_reasons(package,metadata,current));after=bool(chapter_audio_stale_reasons(package,metadata,current));expected=case=='used-reference-mode'
   assert after==expected,(pdf.name,case,after)
   results.append({'sample':pdf.name,'sourceCharacters':len(text),'case':case,'chapterAStaleBefore':before,'chapterAStaleAfter':after,'expected':expected})
report={'baseCommit':base_commit,'method':'Native PDF text from all three repository public-domain evaluation samples, compiled through accepted synthetic two-chapter Dialogue/Review/Cast/Script fixtures. Canonical recipe compatibility only; no inference, TTS, listening-quality, hosted billing or production test.','cases':results,'passed':len(results)}
(root/'docs/assets/review/generate-recipe/public-domain-probe.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':len(results),'samples':3}))
