import { consolidatedCleanupWarning } from "../../design-kit/cleanupFixture";
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpWizardApi, normalizeDialogueArtifact } from './client'

describe('HttpWizardApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('deletes only the selected working book', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpWizardApi('/api').deleteBook('book-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('reattaches to the active backend job returned by a processing conflict', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        detail: { message: 'This stage is already processing', jobId: 'job-running' },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'job-running', status: 'running', progress: 37,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const job = await new HttpWizardApi('/api').processStage('book-1', 'dialogue', {
      regexes: [], openSpeakerPatterns: [], strategy: 'fill-gaps', attributionTargets: [],
    })

    expect(job).toMatchObject({ id: 'job-running', status: 'running', progress: 37 })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/jobs/job-running', expect.any(Object))
  })

  it('loads persisted jobs for estimate calibration', async () => {
    const jobs = [{
      id: 'job-complete', kind: 'v2:generate', status: 'succeeded',
      started_at: '2026-07-12T10:00:00Z', finished_at: '2026-07-12T10:06:40Z',
      result: { chapters: [{ audioSeconds: 100 }] },
    }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(jobs), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new HttpWizardApi('/api').listBookJobs('book-1')).resolves.toEqual(jobs)
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/jobs', expect.any(Object))
  })

  it('previews dialogue regex and fallback settings without starting a stage job', async () => {
    const result = {
      regexes: [], openSpeakerPatterns: ['^\\?+$'], examples: [],
      summary: { totalTurns: 0, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 0 },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpWizardApi('/api').previewDialogue('book-1', {
      regexes: [], openSpeakerPatterns: ['^\\?+$'], strategy: 'fill-gaps', attributionTargets: ['open-speakers', 'unlabelled-candidates'],
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/dialogue/preview', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ customRegexes: [], openSpeakerPatterns: ['^\\?+$'], attributionTargets: ['open-speakers', 'unlabelled-candidates'] }),
    }))
  })

  it('serializes supported custom regex flags using the backend contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profiles: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpWizardApi('/api').previewDialogue('book-1', {
      regexes: [{
        id: 'custom-radio-play', label: 'Radio play', pattern: '(?P<text>.+)', flags: 'ms',
        priority: 100, enabled: true, builtIn: false,
      }],
      openSpeakerPatterns: [], strategy: 'narrate', attributionTargets: [],
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/dialogue/preview', expect.objectContaining({
      body: JSON.stringify({
        customRegexes: [{
          id: 'custom-radio-play', label: 'Radio play', pattern: '(?P<text>.+)',
          priority: 100, enabled: true, flags: 'ms',
        }],
        openSpeakerPatterns: [], attributionTargets: [], enabledRegexIds: ['custom-radio-play'],
      }),
    }))
  })

  it('sends the explicitly chosen remote attribution route with the Dialogue job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'job-remote', status: 'queued',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpWizardApi('/api').processStage('book-1', 'dialogue', {
      regexes: [], openSpeakerPatterns: [], strategy: 'fill-gaps',
      attributionTargets: ['unlabelled-candidates'], attributionRoute: 'remote',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/stages/dialogue/process', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ settings: {
        customRegexes: [], openSpeakerPatterns: [], attributionTargets: ['unlabelled-candidates'],
        strategy: 'fill-gaps', attributionRoute: 'remote',
      } }),
    }))
  })

  it('keeps accepted manual-correction counts separate from AI attribution', () => {
    const dialogue = normalizeDialogueArtifact({
      revision: 'dialogue-corrected',
      resultSummary: {
        totalTurns: 8, explicitTurns: 2, openSpeakerTurns: 0, unlabelledCandidates: 0,
        conflicts: 0, aiAttributed: 1, userCorrected: 4, unresolved: 1,
      },
      aiWindows: Array.from({ length: 7 }, (_, index) => ({ id: `window-${index}` })),
      userCorrections: Array.from({ length: 4 }, (_, index) => ({ spanId: `span-${index}` })),
      spans: [],
    })

    expect(dialogue?.summary).toMatchObject({ aiAttributed: 1, aiContributions: 3, userCorrected: 4, unresolved: 1 })
  })

  it('keeps a valid remote-model cost receipt on an accepted Dialogue artifact', () => {
    const dialogue = normalizeDialogueArtifact({
      revision: 'dialogue-remote',
      resultSummary: {},
      spans: [],
      remoteUsage: {
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 80,
        estimatedCostUsd: 0.42,
        modelProfile: 'luna-dialogue',
        modelDisplayName: 'Luna',
        providerModels: ['gpt-5.6-luna-2026-07-01'],
      },
    })

    expect(dialogue?.remoteUsage).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 200,
      outputTokens: 80,
      estimatedCostUsd: 0.42,
      modelProfile: 'luna-dialogue',
      modelDisplayName: 'Luna',
      providerModels: ['gpt-5.6-luna-2026-07-01'],
    })
  })

  it('keeps legacy remote cost receipts without inventing the model used', () => {
    const dialogue = normalizeDialogueArtifact({
      revision: 'dialogue-legacy-remote',
      resultSummary: {},
      spans: [],
      remoteUsage: {
        promptTokens: 457523,
        completionTokens: 123740,
        estimatedCostUsd: 1.2,
      },
    })

    expect(dialogue?.remoteUsage).toMatchObject({
      inputTokens: 457523,
      cachedInputTokens: 0,
      outputTokens: 123740,
      estimatedCostUsd: 1.2,
      modelDisplayName: 'Remote model',
    })
  })

  it('sends explicit regex toggles after a preview has established the profile list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profiles: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpWizardApi('/api').previewDialogue('book-1', {
      regexes: [
        { id: 'quotes', label: 'Quotes', pattern: 'x', priority: 1, enabled: true, builtIn: true },
        { id: 'screenplay', label: 'Screenplay', pattern: 'y', priority: 2, enabled: false, builtIn: true },
      ],
      openSpeakerPatterns: [], strategy: 'fill-gaps', attributionTargets: ['unlabelled-candidates'],
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/dialogue/preview', expect.objectContaining({
      body: JSON.stringify({ customRegexes: [], openSpeakerPatterns: [], attributionTargets: ['unlabelled-candidates'], enabledRegexIds: ['quotes'] }),
    }))
  })

  it('fetches and accepts an immutable stage candidate by revision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 'dialogue-2', spans: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'book-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const api = new HttpWizardApi('/api')

    await api.getStageCandidate('book-1', 'dialogue', 'dialogue-2')
    await api.acceptStage('book-1', 'dialogue', 'dialogue-2', [])

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/books/book-1/stages/dialogue/candidates/dialogue-2', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/books/book-1/stages/dialogue/accept', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ revision: 'dialogue-2', decisions: [] }),
    }))
  })

  it('requests a server-signed bulk consequence preview before Review acceptance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      previewToken: 'signed-scope', occurrenceIds: ['o1', 'o2'], action: 'exclude',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const preview = await new HttpWizardApi('/api').previewReviewBulk('book-1', 'review-2', 'o1', 'exclude')

    expect(preview.previewToken).toBe('signed-scope')
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/review/bulk-preview', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ revision: 'review-2', occurrenceId: 'o1', action: 'exclude' }),
    }))
  })

  it('previews a synchronized Review transcript page without publishing it', async () => {
    const result = {
      page: 7, pageCount: 120, imageUrl: '/api/books/book-1/pages/7/image', published: false,
      summary: { spoken: 1, dialogue: 0, excluded: 1 }, spans: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const policies = [{ warningId: 'page-number', action: 'exclude' as const }]

    await expect(new HttpWizardApi('/api').previewReviewTranscript('book-1', 'review-2', 7, policies)).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/review/transcript-preview', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ revision: 'review-2', page: 7, policies }),
    }))
  })

  it('serializes AI occurrence policies without expanding them to warning groups', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ page: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const occurrencePolicies = [{ occurrenceId: 'repair-1', action: 'repair' as const }, { occurrenceId: 'source-check', action: 'keep' as const }]
    await new HttpWizardApi('/api').previewReviewTranscript('book-1', 'review-ai', 1, [], occurrencePolicies)
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/review/transcript-preview', expect.objectContaining({ body: JSON.stringify({ revision: 'review-ai', page: 1, policies: [], occurrencePolicies }) }))
  })

  it('normalizes the clean v2 snapshot into the frontend wizard contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      book: {
        id: 'book-1', title: 'Alice', author: 'Lewis Carroll', source_name: 'alice.pdf', page_count: 120,
        accepted_stage_revisions: [{ stage: 'import', revision: 1 }, { stage: 'extract', revision: 1 }],
      },
      activeArtifacts: { extraction: 'extract-1' }, pendingCandidates: { dialogue: { revision: 'dialogue-pending', status: 'candidate' } }, dialogue: {}, reviewWarnings: [consolidatedCleanupWarning],
      dialogueRecovery: {
        kind: 'malformed-playable-span', spanIds: ['span:p48-b2:1373-1372'], page: 48,
        availableActions: ['rerun-dialogue'],
      },
      reviewInspection: { decisions: [], history: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await new HttpWizardApi('/api').getBookSnapshot('book-1')

    expect(snapshot.book).toMatchObject({ filename: 'alice.pdf', pageCount: 120, completedStages: ['import', 'extract'] })
    expect(snapshot.pendingCandidates?.dialogue).toMatchObject({ revision: 'dialogue-pending', status: 'candidate' })
    expect(snapshot.dialogueRecovery).toMatchObject({
      kind: 'malformed-playable-span', spanIds: ['span:p48-b2:1373-1372'], page: 48,
      availableActions: ['rerun-dialogue'],
    })
    expect(snapshot.warnings[0]).toMatchObject({ decisionScope: "occurrence", readerState: "mixed" })
    expect(snapshot.warnings[0].occurrences[2]).toMatchObject({ replacement: "", availableActions: ["keep", "exclude", "repair"], readerState: "narrator", proposalStatus: "proposed" })
    expect(snapshot.chapters).toEqual([])
  })

  it('does not treat invalidated historical receipts as currently complete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      book: {
        id: 'book-1', title: 'Alice', source_name: 'alice.pdf',
        accepted_stage_revisions: [
          { stage: 'import', revision: 1 }, { stage: 'extract', revision: 1 },
          { stage: 'dialogue', revision: 1 }, { stage: 'review', revision: 2 },
          { stage: 'cast', revision: 1 },
        ],
      },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r2' },
      dialogue: {}, reviewWarnings: [], reviewInspection: { decisions: [], history: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await new HttpWizardApi('/api').getBookSnapshot('book-1')

    expect(snapshot.book.completedStages).toEqual(['import', 'extract', 'dialogue', 'review'])
  })

  it('asks the local backend to open a generated chapter WAV', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpWizardApi('/api').openChapterAudio('book-1', 'chapter-1', 'render-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/books/book-1/chapters/chapter-1/render-1/audio/open',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uploads a voice sample to an editable cast candidate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      revision: 'cast-2', phase: 'audition-review', dossiers: [], proposals: [],
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const sample = new File(['voice'], 'voice.wav', { type: 'audio/wav' })

    const result = await new HttpWizardApi('/api').uploadVoiceSample(
      'book-1', 'cast-1', 'alice', sample, 'The exact words in this sample.',
    )

    expect(result.revision).toBe('cast-2')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/books/book-1/stages/cast/candidates/cast-1/voices/alice/upload',
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect((request.body as FormData).get('file')).toBe(sample)
    expect((request.body as FormData).get('reference_text')).toBe('The exact words in this sample.')
    expect(request.signal).toBeUndefined()
  })

  it('requests an editable local transcript without a language constraint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Automatically detected words.', language: 'English',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const sample = new File(['voice'], 'voice.flac', { type: 'audio/flac' })

    await expect(new HttpWizardApi('/api').transcribeVoiceSample('book-1', sample)).resolves.toEqual({
      text: 'Automatically detected words.', language: 'English',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/books/book-1/voice-samples/transcribe',
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect((request.body as FormData).get('file')).toBe(sample)
    expect(request.signal).toBeUndefined()
  })

  it('deletes one audition from an editable cast candidate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      revision: 'cast-2', phase: 'audition-review', dossiers: [], proposals: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new HttpWizardApi('/api').deleteVoiceAudition(
      'book-1', 'cast-1', 'alice', 'voice-1',
    )

    expect(result.revision).toBe('cast-2')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/books/book-1/stages/cast/candidates/cast-1/voices/alice/voice-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('downloads an M4B with the server-provided filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('m4b', {
      status: 200,
      headers: { 'Content-Disposition': `attachment; filename*=utf-8''A%20Cat.m4b` },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const cover = new File(['cover'], 'cover.png', { type: 'image/png' })
    const download = await new HttpWizardApi('/api').exportM4b('book-1', [
      { chapterId: 'chapter-1', revision: 'render-1' },
    ], { title: 'A Cat', author: 'Maou', description: 'A bedtime edition.', cover, coverPage: 7 })

    expect(download.filename).toBe('A Cat.m4b')
    expect(await download.blob.text()).toBe('m4b')
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/exports/m4b', expect.objectContaining({ method: 'POST' }))
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = request.body as FormData
    expect(JSON.parse(String(body.get('chapters')))).toEqual([{ chapterId: 'chapter-1', revision: 'render-1' }])
    expect(body.get('title')).toBe('A Cat')
    expect(body.get('author')).toBe('Maou')
    expect(body.get('description')).toBe('A bedtime edition.')
    expect(body.get('cover')).toBe(cover)
    expect(body.get('coverPage')).toBe('7')
  })

  it('creates a Library export without downloading the M4B body', async () => {
    const exported = {
      id: 'export-1', bookId: 'book-1', title: 'A Cat', author: 'Maou', filename: 'A Cat.m4b',
      location: '/library/A Cat.m4b', chapterCount: 1, partial: false, sizeBytes: 52_098_007,
      createdAt: '2026-07-19T19:01:26Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(exported), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new HttpWizardApi('/api').createM4bExport('book-1', [
      { chapterId: 'chapter-1', revision: 'render-1' },
    ])

    expect(result).toEqual(exported)
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/exports/m4b', expect.objectContaining({
      method: 'POST',
      headers: { Accept: 'application/json' },
    }))
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect((request.body as FormData).has('description')).toBe(false)
  })

  it('creates the selected audio export without downloading its body', async () => {
    const exported = {
      id: 'export-zip', bookId: 'book-1', title: 'A Cat', author: 'Maou',
      filename: 'A Cat - MP3 chapters.zip', location: '/library/A Cat - MP3 chapters.zip',
      chapterCount: 1, partial: false, sizeBytes: 39_073_505, preset: 'mp3-chapters',
      mediaType: 'application/zip', createdAt: '2026-07-19T19:01:26Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(exported), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new HttpWizardApi('/api').createAudioExport('book-1', [
      { chapterId: 'chapter-1', revision: 'render-1' },
    ], { preset: 'mp3-chapters', title: 'A Cat', description: '' })

    expect(result).toEqual(exported)
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/exports/audio', expect.objectContaining({
      method: 'POST',
      headers: { Accept: 'application/json' },
    }))
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = request.body as FormData
    expect(body.get('preset')).toBe('mp3-chapters')
    expect(body.has('description')).toBe(true)
    expect(body.get('description')).toBe('')
  })

  it('turns structured export failures into a useful message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: { invalidChapterIds: ['chapter-stale'] },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new HttpWizardApi('/api').exportM4b('book-1', [
      { chapterId: 'chapter-stale', revision: 'render-1' },
    ])).rejects.toThrow('Some selected chapters are no longer available. Refresh Export and try again.')
  })

  it('lists and opens persisted Library exports', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'export-1', title: 'Alice' }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const api = new HttpWizardApi('/api')

    expect(await api.listLibrary()).toEqual([{ id: 'export-1', title: 'Alice' }])
    await api.openLibraryExport('export-1')
    await api.revealLibraryExport('export-1')

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/library/export-1/open', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/library/export-1/reveal', expect.objectContaining({ method: 'POST' }))
  })
})
