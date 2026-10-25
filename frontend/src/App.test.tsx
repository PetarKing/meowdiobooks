import { scriptDirectionsWarning } from "../design-kit/scriptDirectionsFixture";
import { cleanupWarning, consolidatedCleanupWarning } from "../design-kit/cleanupFixture";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App, { type AppProps } from './App'
import { normalizeDialogueArtifact, wizardApi } from './api/client'
import { ActionRequiredError } from './api/actionRequired'
import type { CastArtifact, DialogueConflict, DialogueStructuralIssue, Job, WorkflowGateway, WizardSnapshot, WizardStage } from './api/contracts'
import { buildReviewWarningDecisions } from './reviewDecisions'
import { persistWorkflowReturn, publicJourney } from './workflow/navigation'
import { workflowStorageKey } from './workflow/workflowLocation'
import { useWorkflowModel } from './app/useWorkflowModel'

describe('first return paint', () => {
  it('shows quiet restoration before effects run for an explicit book return', () => {
    const html = renderToString(<App workflowPersistenceNamespace="first-paint" initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate' }} />)
    expect(html).toContain('book-return-quiet')
    expect(html).toContain('Opening your book')
    expect(html).not.toContain('book-return-art')
    expect(html).not.toContain('From page')
    expect(wizardApi.getBookSnapshot).not.toHaveBeenCalled()
  })

  it('uses only the current account saved location on the first paint', () => {
    persistWorkflowReturn('book-1', 'generate', { namespace: 'account-a' })
    expect(renderToString(<App workflowPersistenceNamespace="account-a" />)).toContain('book-return-quiet')
    expect(renderToString(<App workflowPersistenceNamespace="account-b" />)).not.toContain('book-return-quiet')
  })

  it.each(['home', 'library'] as const)('keeps an explicit %s visit ahead of an old job marker', view => {
    localStorage.setItem(workflowStorageKey('location', 'first-paint'), JSON.stringify({ view: view === 'home' ? 'create' : 'library', home: true }))
    localStorage.setItem(workflowStorageKey('activeJob', 'first-paint'), 'old-job')
    expect(renderToString(<App workflowPersistenceNamespace="first-paint" />)).not.toContain('book-return-quiet')
  })
})

vi.mock('./api/client', () => ({ wizardApi: {
  importBook: vi.fn(), getBookSnapshot: vi.fn(), previewExtraction: vi.fn(), previewDialogue: vi.fn(),
  previewCasting: vi.fn(), previewReviewBulk: vi.fn(), previewReviewTranscript: vi.fn(),
  getRepresentativePages: vi.fn(), listBooks: vi.fn(), deleteBook: vi.fn(), acceptStage: vi.fn(), processStage: vi.fn(),
  prepareRecordingScript: vi.fn(), splitRecordingScriptChapter: vi.fn(),
  getJob: vi.fn(), listBookJobs: vi.fn(), cancelJob: vi.fn(), openChapterAudio: vi.fn(), createM4bExport: vi.fn(), createAudioExport: vi.fn(), exportM4b: vi.fn(), getStageCandidate: vi.fn(), transcribeVoiceSample: vi.fn(), uploadVoiceSample: vi.fn(), deleteVoiceAudition: vi.fn(),
  listLibrary: vi.fn(), openLibraryExport: vi.fn(), revealLibraryExport: vi.fn(),
}, normalizeDialogueArtifact: vi.fn() }))

const faithfulSummary = {
  totalSpans: 3, retainedSpans: 3, omittedSpans: 0, dialogueSpans: 1, narratorFallbackSpans: 0,
  totalCharacters: 180, retainedCharacters: 180, omittedCharacters: 0, retainedPercent: 100, cutPercent: 0,
  estimatedFullSeconds: 12, estimatedSeconds: 12, estimatedSavedSeconds: 0, totalBlocks: 2, retainedBlocks: 2,
  emptyChapterIds: [], estimationMethod: '15-render-characters-per-second',
  chapters: [{ chapterId: 'chapter-1', totalCharacters: 180, retainedCharacters: 180, dialogueSpans: 1, narratorFallbackSpans: 0, retainedPercent: 100, estimatedSeconds: 12, empty: false }],
}

const base: WizardSnapshot = {
  book: { id: 'book-1', title: 'Alice', author: 'Lewis Carroll', filename: 'alice.pdf', pageCount: 120, completedStages: ['import', 'extract', 'dialogue', 'review', 'cast'] },
  activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r1', cast: 'c1', script: 's1' },
  dialogue: { regexes: [{ id: 'quotes', label: 'Curly quotes', pattern: '“(?<text>.+?)”', priority: 1, enabled: true, builtIn: true, matchCount: 12, examples: [{ spanId: 's1', page: 2, source: '“Wait,”', spokenText: 'Wait,', speakerStatus: 'unlabelled', origin: 'quotes' }] }], openSpeakerPatterns: ['^\\?+$'], summary: { totalTurns: 12, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 12, conflicts: 0 }, examples: [] },
  warnings: [], boundaryCandidates: [], reviewInspection: { decisions: [], boundaryDecisions: [], consequences: {}, history: [] },
  cast: { revision: 'c1', phase: 'accepted', dossiers: [], proposals: [], narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'voice-rev-1', previewUrl: '/n.wav' }, identities: [] },
  voiceModels: [{ id: 'qwen', label: 'Qwen', supportedLanguages: ['english'] }], voiceSelection: { modelId: 'qwen', language: 'english' },
  recordingScript: { revision: 's1', status: 'ready', sourceCoverage: { status: 'exact' }, entries: [{ chapterId: 'chapter-1' }], summary: faithfulSummary, inputRevisions: { dialogue: 'd1', review: 'r1', cast: 'c1' } },
  chapters: [{ id: 'chapter-1', title: 'Down the Rabbit-Hole', startPage: 1, endPage: 12 }],
  generatedChapters: [{ chapterId: 'chapter-1', revision: 'audio-1', audioUrl: '/chapter.wav', audioSeconds: 11, current: true, staleReasons: [], segments: [{ id: 'seg-1', characterId: 'alice', text: 'Wait.', sourceSpanId: 's1' }], inputRevisions: { dialogue: 'd1', cast: 'c1' } }],
  history: {},
}

async function open(
  snapshot: WizardSnapshot = base,
  localBooks = [{ id: 'book-1', title: 'Alice', source_name: 'alice.pdf', source_kind: 'pdf', page_count: 120 }],
  representativePages = [{ page: 1, reason: 'opening' }],
  snapshotAfterPreparation?: WizardSnapshot,
  appProps?: AppProps,
) {
  vi.mocked(wizardApi.listBooks).mockResolvedValue(localBooks)
  if (snapshotAfterPreparation) {
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValueOnce(snapshot).mockResolvedValue(snapshotAfterPreparation)
  } else {
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
  }
  vi.mocked(wizardApi.prepareRecordingScript).mockResolvedValue(snapshot.recordingScript ?? base.recordingScript!)
  if (snapshot.dialogue) vi.mocked(wizardApi.previewDialogue).mockResolvedValue({
    ...snapshot.dialogue,
    routing: snapshot.dialogue.routing ?? {
      targetCount: snapshot.dialogue.summary.unlabeledCandidates + snapshot.dialogue.summary.openSpeakerTurns,
      largeReviewThreshold: 100,
      shouldPrompt: false,
      defaultRoute: 'local',
      local: { displayName: 'Qwen', apiCostUsd: 0 },
    },
  })
  vi.mocked(wizardApi.getRepresentativePages).mockResolvedValue(representativePages)
  vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })
  render(<App {...appProps} />)
  await screen.findByRole('button', { name: /Alice.*Continue/ })
  await waitFor(() => expect(wizardApi.listBookJobs).toHaveBeenCalledWith('book-1'))
  fireEvent.click(screen.getByRole('button', { name: /Alice.*Continue/ }))
  await waitFor(() => {
    const alert = screen.queryByRole('alert')
    if (alert) throw new Error(`Opening test book failed: ${alert.textContent}`)
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledWith('book-1')
    expect(screen.getByRole('navigation', { name: 'Wizard stages' })).toBeInTheDocument()
  })
}

describe('v2 wizard', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); window.history.replaceState({}, "", "/"); vi.mocked(normalizeDialogueArtifact).mockReturnValue(undefined); vi.mocked(wizardApi.listBooks).mockResolvedValue([]); vi.mocked(wizardApi.listBookJobs).mockResolvedValue([]); vi.mocked(wizardApi.listLibrary).mockResolvedValue([]); vi.mocked(wizardApi.transcribeVoiceSample).mockResolvedValue({ text: 'Automatic draft.', language: 'English' }); vi.mocked(wizardApi.previewReviewTranscript).mockImplementation(async (_bookId, _revision, page) => ({ page, pageCount: 120, imageUrl: `/page-${page}.png`, published: false, summary: { spoken: 2, dialogue: 1, excluded: 0 }, spans: [{ id: `n-${page}`, kind: 'narration', reader: 'Narrator', text: 'Alice was beginning to get very tired.', blockId: `p${page}`, sourceStart: 0, sourceEnd: 39 }, { id: `d-${page}`, kind: 'dialogue', reader: 'Alice', text: 'What is the use of a book?', blockId: `p${page}`, sourceStart: 40, sourceEnd: 70 }] })) })

  it.each(['epub', 'text'])('skips extraction and visibly disables it for %s imports and restores', async sourceKind => {
    const snapshot = { ...base, book: { ...base.book, sourceKind, filename: `alice.${sourceKind === 'text' ? 'txt' : 'epub'}`, completedStages: ['import', 'extract'] as WizardStage[] }, generatedChapters: [] }
    await open(snapshot)
    expect(screen.getByRole('button', { name: 'Extract Not needed' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dialogue In progress' })).toHaveAttribute('aria-current', 'step')
    expect(wizardApi.previewExtraction).not.toHaveBeenCalled()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('redirects an old Extract return hint for a text source to Dialogue', async () => {
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...base, book: { ...base.book, sourceKind: 'text', completedStages: ['import', 'extract'] }, generatedChapters: [] })
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'extract' }} />)
    await screen.findByRole('button', { name: 'Dialogue In progress' })
    expect(screen.getByRole('button', { name: 'Extract Not needed' })).toBeDisabled()
    expect(wizardApi.previewExtraction).not.toHaveBeenCalled()
  })

  it('resolves export cover media only while Export is visible', async () => {
    const sourcePageImageUrl = vi.fn(() => '/host-cover.png')
    const gateway: WorkflowGateway = Object.assign(Object.create(wizardApi), { sourcePageImageUrl })
    await open(base, undefined, undefined, undefined, { gateway })
    expect(sourcePageImageUrl).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Product areas' })).getByRole('button', { name: 'Library' }))
    await screen.findByRole('heading', { name: 'Your audiobooks' })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle dark mode' }))
    expect(sourcePageImageUrl).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Product areas' })).getByRole('button', { name: 'Create' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByRole('button', { name: /^Export/ }))
    await screen.findByRole('heading', { name: 'Prepare your audiobook' })
    expect(sourcePageImageUrl).toHaveBeenCalledWith('book-1', 1)
    expect(screen.getByRole('img', { name: 'Current audiobook cover' })).toHaveAttribute('src', '/host-cover.png')
  })

  it('partitions a warning group into server-signed identical-evidence decisions', async () => {
    const preview = vi.fn()
      .mockResolvedValueOnce({ targetOccurrenceIds: ['o1', 'o2'], previewToken: 'same-header' })

    const decisions = await buildReviewWarningDecisions(
      'book-1',
      'review-2',
      [{
        id: 'repeated-matter', kind: 'repeated-matter', detail: 'Repeated page furniture', severity: 'warning',
        availableActions: ['exclude'],
        occurrences: [
          { id: 'o1', source: 'Alice', text: 'Alice', page: 1 },
          { id: 'o2', source: 'Alice', text: 'Alice', page: 2 },
          { id: 'o3', source: 'Wonderland', text: 'Wonderland', page: 3 },
        ],
      }],
      { 'repeated-matter': 'exclude' },
      preview,
    )

    expect(decisions).toEqual([
      { occurrenceIds: ['o1', 'o2'], action: 'exclude', provenance: 'user', previewToken: 'same-header' },
      { occurrenceIds: ['o3'], action: 'exclude', provenance: 'user' },
    ])
    expect(preview).toHaveBeenNthCalledWith(1, 'book-1', 'review-2', 'o1', 'exclude')
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('shows only released product navigation', async () => {
    render(<App />)
    const productNavigation = within(screen.getByRole('navigation', { name: 'Product areas' }))
    expect(productNavigation.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(productNavigation.getByRole('button', { name: 'Library' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Player/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Coming soon/)).not.toBeInTheDocument()
  })

  it('shows persisted M4B exports in a top-level local Library', async () => {
    vi.mocked(wizardApi.listLibrary).mockResolvedValue([{
      id: 'export-1', bookId: 'book-1', title: 'Alice', author: 'Lewis Carroll', filename: 'Alice.m4b',
      location: '/Users/test/Music/Meowdiobooks/Alice.m4b', chapterCount: 12, partial: false,
      chapterTitles: ['Down the Rabbit-Hole', 'The Pool of Tears'], chapterPositions: [1, 2],
      sizeBytes: 12 * 1024 * 1024, createdAt: '2026-07-13T14:00:00Z',
    }])
    render(<App />)

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Product areas' })).getByRole('button', { name: /Library/ }))
    expect(await screen.findByRole('heading', { name: 'Your audiobooks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByText('12 chapters')).toBeInTheDocument()
    expect(screen.queryByText('Down the Rabbit-Hole · The Pool of Tears')).not.toBeInTheDocument()
    expect(screen.getByText('12.0 MiB')).toBeInTheDocument()
    expect(screen.getByText('High-quality M4B')).toBeInTheDocument()
    expect(screen.getByAltText('Cover of Alice')).toHaveAttribute('src', '/api/library/export-1/cover')

    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    await waitFor(() => expect(wizardApi.revealLibraryExport).toHaveBeenCalledWith('export-1'))
  })

  it('distinguishes an initial Library failure from empty and recovers with retry', async () => {
    const edition = {
      id: 'export-1', bookId: 'book-1', title: 'Alice', author: 'Lewis Carroll', filename: 'Alice.m4b',
      location: '/library/Alice.m4b', chapterCount: 12, partial: false,
      sizeBytes: 12 * 1024 * 1024, createdAt: '2026-07-13T14:00:00Z',
    }
    vi.mocked(wizardApi.listLibrary).mockRejectedValueOnce(new Error('Library could not be loaded. Try again.')).mockResolvedValueOnce([edition])
    window.history.replaceState({}, "", "/library")

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Library could not be loaded. Try again.')
    expect(screen.queryByRole('heading', { name: 'No audiobooks yet.' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(wizardApi.listLibrary).toHaveBeenCalledTimes(2)
    fireEvent.error(screen.getByAltText('Cover of Alice'))
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open audiobook' })).toBeEnabled()
    expect(screen.queryByAltText('Cover of Alice')).not.toBeInTheDocument()
  })

  it('preserves last good Library editions through a failed refresh and retry', async () => {
    const editions = [{
      id: 'export-1', bookId: 'book-1', title: 'Alice', author: 'Lewis Carroll', filename: 'Alice.m4b',
      location: '/library/Alice.m4b', chapterCount: 12, partial: false,
      sizeBytes: 12 * 1024 * 1024, createdAt: '2026-07-13T14:00:00Z',
    }]
    let finishRetry!: (value: typeof editions) => void
    vi.mocked(wizardApi.listLibrary).mockResolvedValueOnce(editions).mockRejectedValueOnce(new Error('Library could not be loaded. Try again.')).mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve }))
    render(<App />)
    await screen.findByRole('button', { name: 'Library, 1 audiobooks' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Product areas' })).getByRole('button', { name: /Library/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Library could not be loaded. Try again.')
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading audiobooks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    finishRetry(editions)
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
    expect(wizardApi.listLibrary).toHaveBeenCalledTimes(3)
  })

  it('summarizes a selected chapter edition without dumping a long list', async () => {
    vi.mocked(wizardApi.listLibrary).mockResolvedValue([{
      id: 'export-2', bookId: 'book-1', title: 'Alice: A Shorter Journey', author: 'Lewis Carroll', filename: 'Alice selected.m4b',
      location: '/Users/test/Music/Meowdiobooks/Alice selected.m4b', chapterCount: 4, partial: true,
      chapterTitles: ['Down the Rabbit-Hole', 'The Pool of Tears', 'A Caucus-Race', 'A Mad Tea-Party'],
      chapterPositions: [1, 2, 3, 7], sizeBytes: 8 * 1024 * 1024, createdAt: '2026-07-13T14:00:00Z',
    }])
    render(<App />)

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Product areas' })).getByRole('button', { name: /Library/ }))

    expect(await screen.findByText('Chapters 1–3 & 7')).toBeInTheDocument()
    expect(screen.queryByText('Down the Rabbit-Hole · The Pool of Tears + 2 more')).not.toBeInTheDocument()
  })

  it('lets a composed edition replace local Library actions', async () => {
    vi.mocked(wizardApi.listLibrary).mockResolvedValue([{
      id: 'export-1', bookId: 'book-1', title: 'Alice', author: 'Lewis Carroll', filename: 'Alice.m4b',
      location: '/library/Alice.m4b', chapterCount: 12, partial: false,
      sizeBytes: 12 * 1024 * 1024, createdAt: '2026-07-13T14:00:00Z',
    }])
    const renderLibraryActions = vi.fn(() => <button>Download M4B</button>)
    render(<App renderLibraryActions={renderLibraryActions} />)

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Product areas' })).getByRole('button', { name: /Library/ }))

    expect(await screen.findByRole('button', { name: 'Download M4B' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open audiobook' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show in Finder' })).not.toBeInTheDocument()
    expect(renderLibraryActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'export-1', bookId: 'book-1' }))
  })

  it('restores top-level product URLs and uses a skeleton only for a cold Library load', async () => {
    let resolveLibrary!: (value: Awaited<ReturnType<typeof wizardApi.listLibrary>>) => void
    vi.mocked(wizardApi.listLibrary).mockImplementation(() => new Promise((resolve) => { resolveLibrary = resolve }))
    window.history.replaceState({}, "", "/library")

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Your audiobooks' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading audiobooks' })).toHaveAttribute('aria-busy', 'true')
    resolveLibrary([])
    await screen.findByRole('heading', { name: 'No audiobooks yet.' })

    expect(screen.queryByRole('button', { name: /Player/ })).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/library')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(window.location.pathname).toBe('/')

    window.history.replaceState({}, "", "/library")
    fireEvent.popState(window)
    expect(await screen.findByRole('heading', { name: 'Your audiobooks' })).toBeInTheDocument()
  })

  it('renders the six visible phases and resumes at Generate', async () => {
    await open()
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    expect(within(nav).queryByText('Import')).not.toBeInTheDocument()
    for (const label of ['Extract','Dialogue','Review','Cast & voices','Generate','Export']) expect(within(nav).getByText(label)).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Generate Complete' })).toHaveClass('done')
    expect(screen.getByRole('complementary', { name: 'Wizard stages' })).toContainElement(nav)
    expect(screen.getByRole('heading', { level: 2, name: 'Down the Rabbit-Hole' })).toBeInTheDocument()
    expect(screen.getByText('Record your chapters')).toBeInTheDocument()
    expect(screen.getByText('Step 5 · Generate')).toBeInTheDocument()
  })

  it('names the actual prerequisite for every locked workflow stage', async () => {
    await open({
      ...base,
      book: { ...base.book, completedStages: ['import'] },
      activeArtifacts: {},
      generatedChapters: [],
    })

    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    expect(within(nav).getByRole('button', { name: 'Dialogue Complete Extract first' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: 'Review Complete Dialogue first' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: 'Cast & voices Complete Review first' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: 'Generate Complete Cast & voices first' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: 'Export Generate audio first' })).toBeDisabled()
  })

  it('does not mark Generate complete when its only chapter audio is stale', async () => {
    await open({
      ...base,
      generatedChapters: base.generatedChapters.map((chapter) => ({
        ...chapter,
        current: false,
        staleReasons: ['cast:c1->c2'],
      })),
    })

    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    expect(within(nav).getByRole('button', { name: 'Generate In progress' })).not.toHaveClass('done')
    expect(within(nav).getByRole('button', { name: 'Export Generate audio first' })).toBeDisabled()
  })

  it('lets an embedding shell insert a custom step and replace the header without copying the public app', async () => {
    const journey = publicJourney.insertAfter('cast', { id: 'soundscape', label: 'Soundscape' })

    await open(base, undefined, undefined, undefined, {
      journey,
      stepOverrides: { soundscape: () => <h1>Custom ambient-effects workflow</h1> },
      renderHeader: ({ libraryCount }) => <header>Custom shell · {libraryCount} books</header>,
    })

    expect(screen.getByText('Custom shell · 0 books')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Soundscape Ready' }))
    expect(screen.getByRole('heading', { name: 'Custom ambient-effects workflow' })).toBeInTheDocument()
  })

  it('names the active mobile step and respects a custom journey length', async () => {
    const journey = publicJourney.insertAfter('cast', { id: 'soundscape', label: 'Soundscape' })

    await open(base, undefined, undefined, undefined, {
      journey,
      stepOverrides: { soundscape: () => <h1>Custom ambient-effects workflow</h1> },
    })

    const progress = screen.getByRole('status', { name: 'Workflow progress' })
    expect(progress).toHaveTextContent('Step 6 of 7 · Generate')

    fireEvent.click(screen.getByRole('button', { name: 'Soundscape Ready' }))
    expect(progress).toHaveTextContent('Step 5 of 7 · Soundscape')
  })

  it('collapses the wizard rail without changing the active stage', async () => {
    await open()
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    const workspace = nav.closest('.workspace')!
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(workspace).not.toHaveClass('rail-collapsed')
    expect(within(nav).getByRole('button', { name: 'Cast & voices Complete' })).toHaveAttribute('title', 'Cast & voices · Complete')

    fireEvent.click(toggle)

    expect(workspace).toHaveClass('rail-collapsed')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('meowdiobooks.sidebarCollapsed')).toBe('true')
    expect(screen.getByText('Step 5 · Generate')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Cast & voices Complete' })).toHaveAttribute('title', 'Cast & voices · Complete')
  })

  it('restores the collapsed wizard rail preference', async () => {
    localStorage.setItem('meowdiobooks.sidebarCollapsed', 'true')

    await open()

    expect(screen.getByRole('navigation', { name: 'Wizard stages' }).closest('.workspace')).toHaveClass('rail-collapsed')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('recommends LiteParse and keeps the extraction previews in one matched comparison row', async () => {
    await open({ ...base, book: { ...base.book, completedStages: ['import'] as WizardStage[] } })

    expect(screen.getByRole('heading', { name: 'Check the extracted text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Standard Recommended Works well for most books/ })).toHaveClass('selected')
    const comparison = screen.getByText('ORIGINAL PAGE').closest('.compare')
    expect(comparison).toHaveClass('extract-compare')
    expect(comparison).toHaveClass('page-comparison')
    expect(within(comparison as HTMLElement).getByText('Standard TEXT')).toBeInTheDocument()
  })

  it('explains extraction methods without changing the selected parser', async () => {
    await open({ ...base, book: { ...base.book, completedStages: ['import'] as WizardStage[] } })

    const liteparseInfo = screen.getByRole('button', { name: 'About Standard' })
    const nativeInfo = screen.getByRole('button', { name: 'About Embedded text' })
    const layoutInfo = screen.getByRole('button', { name: 'About Complex layout' })
    const liteparseTooltip = document.getElementById(liteparseInfo.getAttribute('aria-describedby')!)
    const nativeTooltip = document.getElementById(nativeInfo.getAttribute('aria-describedby')!)
    const layoutTooltip = document.getElementById(layoutInfo.getAttribute('aria-describedby')!)
    const previewCalls = vi.mocked(wizardApi.previewExtraction).mock.calls.length

    expect(liteparseTooltip).toHaveTextContent('Fast and reliable for most books')
    expect(nativeTooltip).toHaveTextContent('Try this if the standard method')
    expect(layoutTooltip).toHaveTextContent('Handles complex columns and spacing')
    expect(liteparseTooltip).toHaveAttribute('aria-hidden', 'true')

    fireEvent.mouseEnter(liteparseInfo)
    expect(liteparseTooltip).toHaveAttribute('aria-hidden', 'false')
    expect(nativeTooltip).toHaveAttribute('aria-hidden', 'true')
    fireEvent.mouseLeave(liteparseInfo)
    expect(liteparseTooltip).toHaveAttribute('aria-hidden', 'true')

    layoutInfo.focus()
    fireEvent.focus(layoutInfo)
    expect(layoutTooltip).toHaveAttribute('aria-hidden', 'false')
    fireEvent.mouseEnter(layoutInfo)
    fireEvent.keyDown(layoutInfo, { key: 'Escape' })
    expect(layoutTooltip).toHaveAttribute('aria-hidden', 'true')
    expect(layoutInfo).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(layoutInfo)
    fireEvent.mouseLeave(layoutInfo)
    expect(layoutTooltip).toHaveAttribute('aria-hidden', 'true')
    layoutInfo.blur()
    expect(layoutTooltip).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(nativeInfo)
    expect(nativeTooltip).toHaveAttribute('aria-hidden', 'false')
    fireEvent.click(nativeInfo)
    expect(nativeTooltip).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: /Standard Recommended Works well for most books/ })).toHaveClass('selected')
    expect(screen.getByRole('button', { name: /Embedded text Reads text saved in the PDF/ })).not.toHaveClass('selected')
    expect(wizardApi.previewExtraction).toHaveBeenCalledTimes(previewCalls)

    fireEvent.click(screen.getByRole('button', { name: /Embedded text Reads text saved in the PDF/ }))
    expect(screen.getByRole('button', { name: /Embedded text Reads text saved in the PDF/ })).toHaveClass('selected')
    expect(wizardApi.previewExtraction).toHaveBeenCalledTimes(previewCalls + 1)
  })

  it('keeps the clicked extraction page mounted and focused while its preview loads', async () => {
    await open(
      { ...base, book: { ...base.book, completedStages: ['import'] as WizardStage[] } },
      undefined,
      [{ page: 1, reason: 'opening' }, { page: 12, reason: 'dense dialogue' }],
    )
    let finishPreview!: (value: Awaited<ReturnType<typeof wizardApi.previewExtraction>>) => void
    vi.mocked(wizardApi.previewExtraction).mockImplementationOnce(() => new Promise((resolve) => { finishPreview = resolve }))
    const pageButton = await screen.findByRole('button', { name: /p\. 12 dense dialogue/ })

    pageButton.focus()
    fireEvent.click(pageButton)

    expect(pageButton.isConnected).toBe(true)
    expect(pageButton).toHaveFocus()
    finishPreview({ page: 12, pageCount: 120, method: 'liteparse', text: 'The Caterpillar spoke.', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page-12.png' })
    await screen.findByText('The Caterpillar spoke.')
    expect(pageButton.isConnected).toBe(true)
    expect(pageButton).toHaveFocus()
  })

  it('presents Generate as a compact chapter library with useful estimates and audio actions', async () => {
    await open()

    const chapter = screen.getByRole('heading', { name: 'Down the Rabbit-Hole' }).closest<HTMLElement>('.chapter-card')!
    expect(chapter).toHaveClass('has-audio')
    expect(chapter).toHaveClass('generated')
    expect(within(chapter).getByText('Generated')).toBeInTheDocument()
    expect(within(chapter).getByText('Pages 1–12')).toBeInTheDocument()
    expect(within(chapter).getByText('11 sec')).toBeInTheDocument()
    expect(within(chapter).queryByText('Generation')).not.toBeInTheDocument()
    expect(screen.queryByText('Audio to make')).not.toBeInTheDocument()
    fireEvent.click(within(chapter).getByRole('button', { name: 'Listen to Down the Rabbit-Hole' }))
    const player = screen.getByRole('dialog', { name: 'Down the Rabbit-Hole' })
    expect(within(player).getByText('Chapter audio')).toBeInTheDocument()
    expect(player.querySelector('audio')).toHaveAttribute('src', '/chapter.wav')
    expect(screen.queryByRole('button', { name: /Open WAV/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument()
    expect(player).toHaveFocus()
    fireEvent.keyDown(player, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Down the Rabbit-Hole' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Filter chapters' })).not.toBeInTheDocument()
    expect(chapter.querySelector('.chapter-track-number')).toHaveTextContent('01')
    expect(chapter.querySelector('img')).not.toBeInTheDocument()
    expect(document.querySelector('.generate-cover-stack')).not.toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'Down the Rabbit-Hole' }).closest<HTMLElement>('.chapter-card')!).getByText('Generated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue to Export/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /M4B/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument()
    expect(document.querySelector('.chapter-card-grid')).not.toHaveClass('has-selection')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' }))
    expect(document.querySelector('.chapter-card-grid')).toHaveClass('has-selection')
    expect(screen.getByRole('heading', { name: 'Down the Rabbit-Hole' }).closest('.chapter-card')).toHaveClass('selected')
    expect(screen.queryByText('More options')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Export →' }))
    expect(screen.getByRole('heading', { name: 'Prepare your audiobook' })).toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('routes malformed Dialogue to Review and opens a fresh prefilled preview', async () => {
    const recoverySnapshot: WizardSnapshot = {
      ...base,
      dialogueRecovery: {
        kind: 'malformed-playable-span',
        spanIds: ['span:p48-b2:1373-1372'],
        page: 48,
        availableActions: ['rerun-dialogue'],
      },
    }
    await open(recoverySnapshot)

    expect(screen.getByRole('heading', { name: 'Dialogue needs rebuilding' })).toBeInTheDocument()
    expect(screen.getByText('Part of the transcript on page 48 could not be matched to your source document. No audio was generated or changed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review Complete' })).toHaveClass('active')
    expect(screen.queryByRole('button', { name: /Generate .* selected/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cast & voices Complete' }))
    expect(screen.getByRole('button', { name: 'Review Complete' })).toHaveClass('active')
    expect(screen.getByRole('heading', { name: 'Dialogue needs rebuilding' })).toBeInTheDocument()
    const previewsBeforeRecovery = vi.mocked(wizardApi.previewDialogue).mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /Rebuild Dialogue/ }))

    expect(await screen.findByRole('heading', { name: 'Build the transcript' })).toBeInTheDocument()
    expect(wizardApi.previewDialogue).toHaveBeenCalledTimes(previewsBeforeRecovery + 1)
    expect(wizardApi.previewDialogue).toHaveBeenLastCalledWith('book-1', expect.objectContaining({
      strategy: 'fill-gaps',
      regexes: [expect.objectContaining({ id: 'quotes', enabled: true })],
    }))
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()
    expect(wizardApi.openChapterAudio).not.toHaveBeenCalled()
  })

  it('opens recovery without preparing a missing recording script', async () => {
    const recoverySnapshot: WizardSnapshot = {
      ...base,
      activeArtifacts: { ...base.activeArtifacts, script: undefined },
      recordingScript: undefined,
      dialogueRecovery: {
        kind: 'malformed-playable-span',
        spanIds: ['span:p48-b2:1373-1372'],
        page: 48,
        availableActions: ['rerun-dialogue'],
      },
    }

    await open(recoverySnapshot)

    expect(screen.getByRole('heading', { name: 'Dialogue needs rebuilding' })).toBeInTheDocument()
    expect(wizardApi.prepareRecordingScript).not.toHaveBeenCalled()
  })

  it('offers a simple confirmed split for one selected two-hour chapter', async () => {
    const longChapter = { id: 'complete-document', title: 'Complete document', startPage: 1, endPage: 223, estimatedCharacters: 135_000 }
    const longSummary = {
      ...faithfulSummary,
      estimatedSeconds: 9_000,
      chapters: [{ ...faithfulSummary.chapters[0], chapterId: longChapter.id, totalCharacters: 135_000, retainedCharacters: 135_000, estimatedSeconds: 9_000 }],
    }
    const snapshot: WizardSnapshot = {
      ...base,
      recordingScript: { ...base.recordingScript!, revision: 'script-long', summary: longSummary, chapters: [longChapter] },
      chapters: [longChapter],
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Split Complete document into shorter chapters' }))
    const dialog = screen.getByRole('dialog', { name: 'Split this into shorter chapters?' })
    expect(within(dialog).getByText('≈ 5 chapters')).toBeInTheDocument()
    expect(within(dialog).getByText(/Review, cast and voices stay unchanged\./)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Split this into shorter chapters?' })).not.toBeInTheDocument()

    const parts = Array.from({ length: 5 }, (_value, index) => ({
      id: `complete-document--part-${String(index + 1).padStart(2, '0')}`,
      title: `Complete document · Part ${index + 1}`,
      splitFrom: 'complete-document',
      partNumber: index + 1,
      partCount: 5,
    }))
    const splitScript = { ...snapshot.recordingScript!, revision: 'script-split', chapters: parts }
    vi.mocked(wizardApi.splitRecordingScriptChapter).mockResolvedValue(splitScript)
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, recordingScript: splitScript, chapters: parts })

    fireEvent.click(screen.getByRole('button', { name: 'Split Complete document into shorter chapters' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Split this into shorter chapters?' })).getByRole('button', { name: 'Split into ≈ 5 chapters' }))

    await waitFor(() => expect(wizardApi.splitRecordingScriptChapter).toHaveBeenCalledWith('book-1', 'complete-document'))
    expect(await screen.findByRole('heading', { name: 'Complete document · Part 1' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Complete document' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Generation action' })).toHaveTextContent('5 chapters selected')
  })

  it('clears every chapter selection when the filter changes', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      recordingScript: { ...base.recordingScript!, summary: { ...faithfulSummary, chapters: [
        ...faithfulSummary.chapters,
        { chapterId: 'chapter-2', totalCharacters: 900, retainedCharacters: 900, dialogueSpans: 2, narratorFallbackSpans: 0, retainedPercent: 100, estimatedSeconds: 60, empty: false },
        { chapterId: 'chapter-3', totalCharacters: 1800, retainedCharacters: 1800, dialogueSpans: 4, narratorFallbackSpans: 0, retainedPercent: 100, estimatedSeconds: 120, empty: false },
      ] } },
      chapters: [
        ...base.chapters,
        { id: 'chapter-2', title: 'The Pool of Tears', startPage: 13, endPage: 24 },
        { id: 'chapter-3', title: 'A Caucus-Race', startPage: 25, endPage: 36 },
      ],
    }
    await open(snapshot)

    fireEvent.click(screen.getByRole('tab', { name: /Generated/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' }))
    expect(screen.getByRole('region', { name: 'Generation action' })).toHaveTextContent('1 chapter selected')

    fireEvent.click(screen.getByRole('tab', { name: /To make/ }))
    expect(screen.queryByRole('heading', { name: 'Down the Rabbit-Hole' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Generation action' })).not.toHaveTextContent('selected')
    expect(screen.getByRole('heading', { name: 'The Pool of Tears' }).closest('.chapter-card')).not.toHaveTextContent('Ready')

    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByRole('region', { name: 'Generation action' })).toHaveTextContent('2 chapters selected')
    fireEvent.click(screen.getByRole('tab', { name: /Generated/ }))
    expect(screen.getByRole('region', { name: 'Generation action' })).not.toHaveTextContent('selected')
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).not.toBeChecked()
    const generatedTab = screen.getByRole('tab', { name: /Generated/ })
    generatedTab.focus()
    fireEvent.keyDown(generatedTab, { key: 'Home' })
    const pendingTab = screen.getByRole('tab', { name: /^To make/ })
    expect(pendingTab).toHaveFocus()
    fireEvent.keyDown(pendingTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Generated/ })).toHaveFocus()
    expect(screen.getByRole('tab', { name: /Generated/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps a generation failure beside its retry action and preserves saved audio', async () => {
    await open({ ...base,
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears', startPage: 13, endPage: 24 }],
      recordingScript: { ...base.recordingScript!, summary: { ...faithfulSummary, chapters: [
        ...faithfulSummary.chapters,
        { chapterId: 'chapter-2', totalCharacters: 900, retainedCharacters: 900, dialogueSpans: 2, narratorFallbackSpans: 0, retainedPercent: 100, estimatedSeconds: 60, empty: false },
      ] } },
    })
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'generate-failed', status: 'failed', error: 'Synthesis interrupted; saved tracks are unchanged.' })
    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    const action = screen.getByRole('region', { name: 'Generation action' })
    expect(await within(action).findByText('Something went wrong while completing this step. Try again; your accepted work is unchanged.')).toBeVisible()
    expect(within(action).getByText('Generation needs attention')).toBeInTheDocument()
    expect(within(action).getByRole('button', { name: /^Generate 1 selected →$/ })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Select The Pool of Tears' })).toBeChecked()
    fireEvent.click(screen.getByRole('tab', { name: /Generated/ }))
    expect(screen.getByRole('button', { name: 'Listen to Down the Rabbit-Hole' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
  })

  it.each(['immediate', 'polled'] as const)('selects the newly generated tracks and carries that selection to Export after %s completion', async (completion) => {
    const snapshot: WizardSnapshot = {
      ...base,
      chapters: [...base.chapters,
        { id: 'chapter-2', title: 'The Pool of Tears', startPage: 13, endPage: 24 },
        { id: 'chapter-3', title: 'A Caucus-Race', startPage: 25, endPage: 36 },
      ],
    }
    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select The Pool of Tears' }))
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, generatedChapters: [
      ...snapshot.generatedChapters,
      { chapterId: 'chapter-2', revision: 'new-audio-2', audioUrl: '/new-2.wav', audioSeconds: 60, current: true, staleReasons: [] },
    ] })
    const finished: Job = { id: 'generate-selection', kind: 'v2:generate', status: 'succeeded', result: { chapters: [{ chapterId: 'chapter-2', revision: 'new-audio-2' }] } }
    vi.mocked(wizardApi.processStage).mockResolvedValue(completion === 'immediate' ? finished : { ...finished, status: 'running', progress: 20 })
    vi.mocked(wizardApi.getJob).mockResolvedValue(finished)

    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Generated 2' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('checkbox', { name: 'Select The Pool of Tears' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select A Caucus-Race' })).not.toBeInTheDocument()
    const action = screen.getByRole('region', { name: 'Generation action' })
    expect(within(action).getByRole('button', { name: 'Continue to Export →' })).toHaveClass('primary')
    fireEvent.click(within(action).getByRole('button', { name: 'Continue to Export →' }))

    expect(screen.getByRole('heading', { name: 'Prepare your audiobook' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Chapter 01, 11 sec' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Chapter 02, 1 min' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create high-quality M4B →' }))
    await waitFor(() => expect(wizardApi.createAudioExport).toHaveBeenCalledWith('book-1', [{ chapterId: 'chapter-2', revision: 'new-audio-2' }], expect.anything()))
  })

  it('exports a selected current recording with its original revision without generation', async () => {
    await open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' }))
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked()
    expect(screen.queryByText('More options')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Export →' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create high-quality M4B →' }))
    await waitFor(() => expect(wizardApi.createAudioExport).toHaveBeenCalledWith('book-1', [{ chapterId: 'chapter-1', revision: 'audio-1' }], expect.anything()))
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('filters direct generation requests to unique valid missing or stale chapters before host admission', async () => {
    const snapshot: WizardSnapshot = { ...base,
      chapters: [...base.chapters,
        { id: 'chapter-2', title: 'The Pool of Tears' },
        { id: 'chapter-3', title: 'A Caucus-Race' },
        { id: 'empty', title: 'Blank page' },
      ],
      recordingScript: { ...base.recordingScript!, summary: { ...faithfulSummary, emptyChapterIds: ['empty'] } },
      generatedChapters: [...base.generatedChapters,
        { chapterId: 'chapter-2', revision: 'old-audio-2', audioUrl: '/older.wav', current: false, staleReasons: ['recipe changed'] },
      ],
    }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.previewDialogue).mockResolvedValue(base.dialogue!)
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'pending-only', status: 'succeeded' })
    const { result } = renderHook(() => useWorkflowModel({ gateway: wizardApi }))
    await act(async () => { await result.current.hydrate('book-1') })

    await act(async () => { await result.current.generateChapters(['chapter-1', 'empty', 'unknown']) })
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    expect(result.current.generationRun).toBeUndefined()
    await act(async () => { await result.current.generateChapters(['chapter-1', 'chapter-2', 'chapter-2', 'chapter-3', 'empty', 'unknown']) })
    expect(wizardApi.processStage).toHaveBeenCalledExactlyOnceWith('book-1', 'generate', { chapterIds: ['chapter-2', 'chapter-3'], language: 'english' })
  })

  it('returns to To make when a changed recipe leaves the previous Generated view empty', async () => {
    const ready: WizardSnapshot = { ...base,
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears' }],
      generatedChapters: [...base.generatedChapters,
        { chapterId: 'chapter-2', revision: 'audio-2', audioUrl: '/two.wav', current: true, staleReasons: [] },
      ],
    }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(ready)
    vi.mocked(wizardApi.previewDialogue).mockResolvedValue(base.dialogue!)
    const { result } = renderHook(() => useWorkflowModel({ gateway: wizardApi }))
    await act(async () => { await result.current.hydrate('book-1') })
    expect(result.current.chapterFilter).toBe('generated')
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...ready,
      cast: { ...ready.cast!, revision: 'c2' },
      activeArtifacts: { ...ready.activeArtifacts, cast: 'c2' },
      generatedChapters: ready.generatedChapters.map(row => ({ ...row, current: false, staleReasons: ['cast recipe changed'] })),
    })
    await act(async () => { await result.current.hydrate('book-1') })
    expect(result.current.chapterFilter).toBe('pending')
    expect(result.current.selectedChapters).toEqual(['chapter-1', 'chapter-2'])
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it.each(['failed', 'canceled'] as const)('preserves saved tracks and selects only unfinished requests for retry after a partially %s job', async (status) => {
    const snapshot: WizardSnapshot = {
      ...base,
      chapters: [...base.chapters,
        { id: 'chapter-2', title: 'The Pool of Tears' },
        { id: 'chapter-3', title: 'A Caucus-Race' },
      ],
    }
    await open(snapshot)
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'generate-partial', kind: 'v2:generate', status, error: 'Stopped after saving Chapter 2.' })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, generatedChapters: [
      ...snapshot.generatedChapters,
      { chapterId: 'chapter-2', revision: 'saved-audio-2', audioUrl: '/saved-2.wav', current: true, staleReasons: [] },
    ] })
    fireEvent.click(screen.getByRole('button', { name: 'Generate 2 selected →' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^Generate 1 selected →$/ })).toBeEnabled())
    expect(wizardApi.processStage).toHaveBeenNthCalledWith(1, 'book-1', 'generate', { chapterIds: ['chapter-2', 'chapter-3'], language: 'english' })
    expect(screen.getByRole('tab', { name: 'To make 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('checkbox', { name: 'Select The Pool of Tears' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select A Caucus-Race' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Generate 1 selected →' }))
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenNthCalledWith(2, 'book-1', 'generate', { chapterIds: ['chapter-3'], language: 'english' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate 1 selected →' })).toBeEnabled())
    fireEvent.click(screen.getByRole('tab', { name: /Generated/ }))
    expect(screen.getByRole('button', { name: 'Listen to Down the Rabbit-Hole' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Listen to The Pool of Tears' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
  })

  it('selects audio saved by a failed generation job for Export when no requested work remains', async () => {
    await open({ ...base, generatedChapters: [] })
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'saved-before-failure', status: 'failed', error: 'All requested tracks were saved before the worker stopped.' })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base)
    fireEvent.click(screen.getByRole('button', { name: 'Generate 1 selected →' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked())
    expect(screen.getByRole('button', { name: 'Continue to Export →' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Listen to Down the Rabbit-Hole' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Regenerate|Generate 1 selected/ })).not.toBeInTheDocument()
    expect(wizardApi.processStage).toHaveBeenCalledTimes(1)
  })

  it('blocks navigation behind a full-screen chapter generation dialog', async () => {
    await open({ ...base, generatedChapters: [] })
    let finishJob!: (job: { id: string; status: 'succeeded'; result: Record<string, never> }) => void
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'generate-job', kind: 'v2:generate', status: 'running', message: 'Synthesizing segment 4/19' })
    vi.mocked(wizardApi.getJob).mockImplementation(() => new Promise((resolve) => { finishJob = resolve }))
    vi.mocked(wizardApi.cancelJob).mockResolvedValue({
      id: 'generate-job', kind: 'v2:generate', status: 'running',
      message: 'Cancellation requested; stopping after the active task',
      cancel_requested_at: '2026-07-20T10:00:00Z',
    })

    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.closest('.process-overlay')).toHaveClass('generation-overlay')
    expect(document.querySelector('.topbar')).toHaveAttribute('inert')
    expect(document.querySelector('.workspace')).toHaveAttribute('inert')
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(within(dialog).getByRole('button', { name: 'Cancel audio generation' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(within(dialog).getByRole('button', { name: 'Cancel audio generation' })).toHaveFocus()
    expect(within(dialog).getByRole('progressbar', { name: 'Chapter generation progress' })).toBeInTheDocument()
    expect(within(dialog).getByText('0 of 1 ready')).toBeInTheDocument()
    expect(within(dialog).getByText('≈ 1 min')).toBeInTheDocument()
    expect(within(dialog).getByText(/Keep Meowdiobooks open/)).toBeInTheDocument()
    expect(screen.queryByText('Synthesizing segment 4/19')).not.toBeInTheDocument()
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledWith('generate-job'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel audio generation' }))
    await waitFor(() => expect(wizardApi.cancelJob).toHaveBeenCalledWith('generate-job'))
    expect(within(dialog).getByRole('button', { name: 'Canceling…' })).toBeDisabled()
    finishJob({ id: 'generate-job', status: 'succeeded', result: {} })
    // The dialog disappears during commit; the passive effect then restores scrolling.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument()
      expect(document.querySelector('.topbar')).not.toHaveAttribute('inert')
      expect(document.querySelector('.workspace')).not.toHaveAttribute('inert')
      expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
    })
  })

  it('keeps resumed generation status compact and updates remaining time from live progress', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      recordingScript: { ...base.recordingScript!, summary: { ...faithfulSummary, chapters: [
        ...faithfulSummary.chapters,
        { chapterId: 'chapter-2', totalCharacters: 900, retainedCharacters: 900, dialogueSpans: 2, narratorFallbackSpans: 0, retainedPercent: 100, estimatedSeconds: 60, empty: false },
        { chapterId: 'chapter-3', totalCharacters: 1800, retainedCharacters: 1800, dialogueSpans: 4, narratorFallbackSpans: 0, retainedPercent: 100, estimatedSeconds: 120, empty: false },
      ] } },
      chapters: [
        ...base.chapters,
        { id: 'chapter-2', title: 'The Pool of Tears', startPage: 13, endPage: 24 },
        { id: 'chapter-3', title: 'A Caucus-Race', startPage: 25, endPage: 36 },
      ],
    }
    let finishJob!: (job: { id: string; status: 'succeeded'; result: Record<string, never> }) => void
    vi.mocked(wizardApi.processStage).mockResolvedValue({
      id: 'generate-job', status: 'running', progress: 50, message: 'chapter-3: segment 1 of 2',
      started_at: new Date(Date.now() - 120_000).toISOString(),
    })
    vi.mocked(wizardApi.getJob).mockImplementation(() => new Promise((resolve) => { finishJob = resolve }))

    await open(snapshot)
    expect(screen.getByRole('region', { name: 'Generation action' })).toHaveTextContent('2 chapters selected')
    fireEvent.click(screen.getByRole('button', { name: 'Generate 2 selected →' }))

    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(await within(dialog).findByText('1 of 2 ready')).toBeInTheDocument()
    expect(within(dialog).getByText('≈ 2 min')).toBeInTheDocument()
    expect(dialog.querySelectorAll('.generation-progress-facts > div')).toHaveLength(2)

    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledWith('generate-job'))
    finishJob({ id: 'generate-job', status: 'succeeded', result: {} })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument())
  })

  it('retries a transient job poll failure when the browser returns to focus', async () => {
    await open({ ...base, generatedChapters: [] })
    vi.mocked(wizardApi.processStage).mockResolvedValue({
      id: 'generate-job', status: 'running', progress: 59,
    })
    vi.mocked(wizardApi.getJob)
      .mockRejectedValueOnce(new TypeError('Network connection was lost'))
      .mockResolvedValueOnce({ id: 'generate-job', status: 'succeeded', result: {} })

    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(await within(dialog).findByText('Reconnecting to processing status…')).toBeInTheDocument()
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBe('generate-job')

    fireEvent(window, new Event('focus'))

    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument())
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
  })

  it('starts a fresh job poll on pageshow when the suspended request is still pending', async () => {
    await open({ ...base, generatedChapters: [] })
    vi.mocked(wizardApi.processStage).mockResolvedValue({
      id: 'generate-job', status: 'running', progress: 59,
    })
    vi.mocked(wizardApi.getJob)
      .mockImplementationOnce(() => new Promise<Job>(() => undefined))
      .mockResolvedValueOnce({ id: 'generate-job', status: 'succeeded', result: {} })

    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(1))

    fireEvent(window, new Event('pageshow'))

    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument())
  })

  it('keeps the generation action footer focused on selection without duration estimates', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      recordingScript: { ...base.recordingScript!, summary: {
        ...faithfulSummary,
        estimatedSeconds: 600,
        chapters: [{ ...faithfulSummary.chapters[0], retainedCharacters: 9000, estimatedSeconds: 600 }],
      } },
      generatedChapters: [],
    }

    await open(snapshot)

    const action = screen.getByRole('region', { name: 'Generation action' })
    expect(action).toHaveTextContent('1 chapter selected')
    expect(action.querySelector('dl')).not.toBeInTheDocument()
    expect(within(action).queryByText('Generation')).not.toBeInTheDocument()
    expect(action).not.toHaveTextContent('≈')
    expect(within(action).getByRole('button', { name: 'Generate 1 selected →' })).toBeEnabled()
  })

  it('uses edition-specific estimates in generation progress while keeping them out of the action footer', async () => {
    const estimatedSeconds = 3917
    const snapshot: WizardSnapshot = {
      ...base,
      recordingScript: { ...base.recordingScript!, summary: {
        ...faithfulSummary,
        estimatedSeconds,
        chapters: [{ ...faithfulSummary.chapters[0], retainedCharacters: 58_755, estimatedSeconds }],
      } },
      generatedChapters: [],
    }
    let finishJob!: (job: { id: string; status: 'succeeded'; result: Record<string, never> }) => void
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'generate-job', status: 'queued' })
    vi.mocked(wizardApi.getJob).mockImplementation(() => new Promise((resolve) => { finishJob = resolve }))

    await open(snapshot, undefined, undefined, undefined, {
      generationEstimatePolicy: {
        fallbackLowerMultiplier: 0.072,
        fallbackUpperMultiplier: 0.144,
      },
    })

    expect(screen.getByRole('region', { name: 'Generation action' })).not.toHaveTextContent('≈')
    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(within(dialog).getByText('≈ 5 min–10 min')).toBeInTheDocument()

    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledWith('generate-job'))
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, generatedChapters: base.generatedChapters })
    finishJob({ id: 'generate-job', status: 'succeeded', result: {} })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Continue to Export →' })).toHaveClass('primary')
  })

  it('uses successful generation history in progress estimates while keeping the action footer clear', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      recordingScript: { ...base.recordingScript!, summary: {
        ...faithfulSummary,
        estimatedSeconds: 600,
        chapters: [{ ...faithfulSummary.chapters[0], retainedCharacters: 9000, estimatedSeconds: 600 }],
      } },
      generatedChapters: [],
    }
    vi.mocked(wizardApi.listBookJobs).mockResolvedValue([{
      id: 'previous-generation', kind: 'v2:generate', status: 'succeeded',
      started_at: '2026-07-12T10:00:00Z', finished_at: '2026-07-12T10:06:40Z',
      result: { chapters: [{ audioSeconds: 40 }, { audioSeconds: 60 }] },
    }])
    let finishJob!: (job: { id: string; status: 'succeeded'; result: Record<string, never> }) => void
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'generate-job', status: 'queued' })
    vi.mocked(wizardApi.getJob).mockImplementation(() => new Promise((resolve) => { finishJob = resolve }))

    await open(snapshot)
    await waitFor(() => expect(wizardApi.listBookJobs).toHaveBeenCalledWith('book-1'))
    expect(screen.getByRole('region', { name: 'Generation action' })).not.toHaveTextContent('≈')
    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(within(dialog).getByText('≈ 40 min–1 hr 20 min')).toBeInTheDocument()

    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledWith('generate-job'))
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, generatedChapters: base.generatedChapters })
    finishJob({ id: 'generate-job', status: 'succeeded', result: {} })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Continue to Export →' })).toHaveClass('primary')
  })

  it('keeps chapter selection, metadata, and a responsive format choice in Export', async () => {
    await open()
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    fireEvent.click(within(nav).getByText('Export').closest('button')!)

    expect(screen.getByRole('heading', { name: 'Prepare your audiobook' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Alice')
    expect(screen.getByLabelText('Author')).toHaveValue('Lewis Carroll')
    expect(screen.getByLabelText('Description')).toHaveValue('Generated by Meowdiobooks')
    expect(screen.getByRole('checkbox', { name: 'Chapter 01, 11 sec' })).toBeChecked()
    expect(screen.getByText('Down the Rabbit-Hole')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /High-quality M4B/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Smaller M4B/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /MP3 chapters.*ZIP download/ })).not.toBeChecked()
    expect(screen.getByText('≈ 172 KiB')).toBeInTheDocument()
    expect(screen.getByText('≈ 86 KiB')).toBeInTheDocument()
    expect(screen.getByText('≈ 129 KiB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create high-quality M4B →' })).toBeEnabled()

    vi.mocked(wizardApi.createAudioExport).mockResolvedValue({
      id: 'export-1', bookId: 'book-1', title: 'Alice', author: 'Lewis Carroll',
      filename: 'Alice - smaller.m4b', location: '/library/Alice - smaller.m4b', chapterCount: 1,
      partial: false, sizeBytes: 3, preset: 'm4b-compact', mediaType: 'audio/mp4',
      createdAt: '2026-07-19T19:01:26Z',
    })
    const title = screen.getByLabelText('Title')
    title.focus()
    fireEvent.change(title, { target: { value: 'Alice — Audiobook' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A personal recording of Alice.' } })
    expect(title).toHaveFocus()
    const preview = screen.getByRole('region', { name: 'Audiobook preview' })
    expect(screen.getByLabelText('Title')).toHaveValue('Alice — Audiobook')
    expect(screen.getByLabelText('Author')).toHaveValue('Lewis Carroll')
    expect(within(preview).getByText('Front page')).toBeInTheDocument()
    const coverPage = screen.getByLabelText('PDF cover page')
    fireEvent.click(screen.getByRole('button', { name: 'Next cover page' }))
    expect(coverPage).toHaveValue(2)
    fireEvent.click(screen.getByRole('button', { name: 'Previous cover page' }))
    expect(coverPage).toHaveValue(1)
    fireEvent.change(coverPage, { target: { value: '' } })
    expect(coverPage).toHaveValue(null)
    expect(screen.getByAltText('Current audiobook cover')).toHaveAttribute('src', '/api/books/book-1/pages/1/image')
    fireEvent.change(coverPage, { target: { value: '7' } })
    expect(screen.getByAltText('Current audiobook cover')).toHaveAttribute('src', '/api/books/book-1/pages/7/image')
    fireEvent.click(screen.getByRole('radio', { name: /Smaller M4B/ }))
    expect(screen.getByRole('button', { name: 'Create smaller M4B →' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Create smaller M4B →' }))
    await waitFor(() => expect(wizardApi.createAudioExport).toHaveBeenCalledWith('book-1', [
      { chapterId: 'chapter-1', revision: 'audio-1' },
    ], { title: 'Alice — Audiobook', author: 'Lewis Carroll', description: 'A personal recording of Alice.', cover: undefined, coverPage: 7, preset: 'm4b-compact' }))
    expect(wizardApi.createM4bExport).not.toHaveBeenCalled()
    expect(wizardApi.exportM4b).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Your audiobooks' })).toBeInTheDocument()
  })

  it('keeps single-page, single-chapter Export concise while retaining selection', async () => {
    await open({ ...base, book: { ...base.book, pageCount: 1 } })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Export'))

    const summary = screen.getByRole('region', { name: 'Export summary' })
    expect(within(summary).getByRole('heading', { name: '1 chapter · 11 sec' })).toBeInTheDocument()
    expect(screen.queryByLabelText('PDF cover page')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next cover page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    expect(screen.getByAltText('Current audiobook cover')).toHaveAttribute('src', '/api/books/book-1/pages/1/image')
    const chapter = screen.getByRole('checkbox', { name: 'Chapter 01, 11 sec' })
    fireEvent.click(chapter)
    expect(within(summary).getByText('Choose at least one chapter')).toBeInTheDocument()
    expect(within(summary).getByRole('button')).toBeDisabled()
    fireEvent.click(chapter)
    expect(within(summary).getByRole('button')).toBeEnabled()
  })

  it('retains bulk chapter selection and updates plural Export summaries', async () => {
    await open({
      ...base,
      chapters: [...base.chapters, { ...base.chapters[0], id: 'chapter-2', title: 'The Pool of Tears' }],
      generatedChapters: [...base.generatedChapters!, { ...base.generatedChapters![0], chapterId: 'chapter-2', revision: 'audio-2' }],
    })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Export'))
    const summary = screen.getByRole('region', { name: 'Export summary' })
    expect(within(summary).getByRole('heading', { name: '2 chapters · 22 sec' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(within(summary).getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(within(summary).getByRole('heading', { name: '1 chapter · 11 sec' })).toBeInTheDocument()
    expect(screen.getByLabelText('PDF cover page')).toHaveValue(1)
  })

  it('keeps Export available when current chapter audio survives backward navigation', async () => {
    await open({
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review', 'cast'] as WizardStage[] },
    })

    const exportButton = within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Export').closest('button')!
    expect(exportButton).toBeEnabled()
    fireEvent.click(exportButton)
    expect(screen.getByRole('heading', { name: 'Prepare your audiobook' })).toBeInTheDocument()
  })

  it('starts Export with the next book’s details after switching local books', async () => {
    const moonlit: WizardSnapshot = {
      ...base,
      book: { ...base.book, id: 'book-2', title: 'The Moonlit Temple', author: 'M. Cat', filename: 'temple.pdf' },
    }
    await open(base, [
      { id: 'book-1', title: 'Alice', source_name: 'alice.pdf', source_kind: 'pdf', page_count: 120 },
      { id: 'book-2', title: 'The Moonlit Temple', source_name: 'temple.pdf', source_kind: 'pdf', page_count: 90 },
    ])
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Export').closest('button')!)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Personal Alice' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Only for Alice' } })
    fireEvent.change(screen.getByLabelText('PDF cover page'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }))

    vi.mocked(wizardApi.getBookSnapshot).mockImplementation(async (bookId) => bookId === 'book-2' ? moonlit : base)
    fireEvent.click(await screen.findByRole('button', { name: /The Moonlit Temple.*Continue/ }))
    await waitFor(() => expect(wizardApi.getBookSnapshot).toHaveBeenCalledWith('book-2'))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Export').closest('button')!)
    expect(screen.getByLabelText('Title')).toHaveValue('The Moonlit Temple')
    expect(screen.getByLabelText('Author')).toHaveValue('M. Cat')
    expect(screen.getByLabelText('Description')).toHaveValue('Generated by Meowdiobooks')
    expect(screen.getByLabelText('PDF cover page')).toHaveValue(1)
  })

  it('opens a concise, phase-specific guide from every wizard step', async () => {
    await open()
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    const phases = [
      ['Extract', 'Check the reading order.'],
      ['Dialogue', 'Choose who reads each line.'],
      ['Review', 'Review the text before recording.'],
      ['Cast & voices', 'Match the characters and their voices.'],
      ['Generate', 'Generate and listen to your chapters.'],
      ['Export', 'Export your audiobook.'],
    ] as const

    for (const [label, guideTitle] of phases) {
      fireEvent.click(within(nav).getByText(label).closest('button')!)
      const help = screen.getByRole('button', { name: `About ${label}` })
      fireEvent.click(help)
      const dialog = screen.getByRole('dialog', { name: guideTitle })
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).queryByRole('banner')).not.toBeInTheDocument()
      expect(dialog.parentElement?.parentElement).toBe(document.body)
      expect(dialog.closest('.step-eyebrow')).toBeNull()
      expect(dialog.querySelectorAll('.phase-help-path li')).toHaveLength(3)
      expect(dialog.querySelectorAll('.phase-help-moves li')).toHaveLength(3)
      for (const cue of dialog.querySelectorAll('.phase-help-cue')) {
        if ([...(cue.textContent ?? '')].length > 3) expect(cue).toHaveClass('is-compact')
      }
      if (label === 'Generate') {
        expect(dialog).toHaveTextContent('recording script uses your approved transcript')
        expect(dialog).toHaveTextContent('Older recordings stay playable')
        expect(dialog).toHaveTextContent('regenerate it before export')
      }
      fireEvent.click(screen.getByRole('button', { name: 'Close phase guide' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })

  it('teaches cast drag operations and closes without disturbing wizard state', async () => {
    await open()
    const chapter = screen.getByRole('checkbox')
    expect(chapter).not.toBeChecked()

    const help = screen.getByRole('button', { name: 'About Generate' })
    fireEvent.click(help)
    expect(screen.getByText(/Uses approved choices/)).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(chapter).not.toBeChecked()
    await waitFor(() => expect(help).toHaveFocus())

    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    fireEvent.click(within(nav).getByText('Cast & voices').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'About Cast & voices' }))
    expect(screen.getByText(/Merge matching characters/)).toBeInTheDocument()
    expect(screen.getByText(/Use Narrator for a role/)).toBeInTheDocument()
    expect(screen.getByText(/Approving a voice saves the audition you selected/)).toBeInTheDocument()
  })

  it('shows inline progress while opening a recent book', async () => {
    let finishHydration!: (snapshot: WizardSnapshot) => void
    vi.mocked(wizardApi.listBooks).mockResolvedValue([{ id: 'book-1', title: 'Alice', source_name: 'alice.pdf', source_kind: 'pdf', page_count: 120 }])
    vi.mocked(wizardApi.getBookSnapshot).mockReturnValue(new Promise((resolve) => { finishHydration = resolve }))
    vi.mocked(wizardApi.getRepresentativePages).mockResolvedValue([{ page: 1, reason: 'opening' }])
    vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })
    render(<App />)

    await screen.findByText('Alice')
    await waitFor(() => expect(wizardApi.listBookJobs).toHaveBeenCalledWith('book-1'))
    const bookButton = screen.getByText('Alice').closest('button')!
    fireEvent.click(bookButton)

    const openingButton = await screen.findByRole('button', { name: /Alice.*Opening/ })
    expect(openingButton).toHaveAttribute('aria-busy', 'true')
    expect(within(openingButton).getByText('Opening…')).toBeInTheDocument()
    expect(openingButton).toBeDisabled()

    finishHydration(base)
    await screen.findByRole('navigation', { name: 'Wizard stages' })
  })

  it('offers only targeted AI attribution or narrator fallback for detected unresolved dialogue', async () => {
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } })
    expect(screen.getByRole('heading', { name: 'Build the transcript' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Suggest speakers with AI/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Use the narrator/ })).toBeInTheDocument()
    expect(screen.getByText('Dialogue labelled as unknown')).toBeInTheDocument()
    expect(screen.getByText('Dialogue with no speaker label')).toBeInTheDocument()
    expect(screen.getByText('I knew you would come.')).toBeInTheDocument()
    expect(screen.getByText('???: Who goes there?')).toBeInTheDocument()
    const scopes = screen.getByRole('group', { name: 'Choose what AI may identify' })
    expect(within(scopes).getAllByRole('checkbox')[0]).toBeChecked()
    expect(within(scopes).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(scopes).getAllByRole('checkbox')[0]).toBeEnabled()
    expect(within(scopes).getByText('None found')).toBeInTheDocument()
    expect(screen.getByText('Dialogue labelled as unknown').closest('.scope-option')).toHaveClass('unavailable')
    fireEvent.click(screen.getByText('Dialogue labelled as unknown'))
    expect(within(scopes).getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByText(/Full-book AI/i)).not.toBeInTheDocument()
    expect(screen.getByText('12 detected turns will use AI.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Dialogue with no speaker label'))
    expect(screen.getByText('No AI speaker matching will run.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build transcript →' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Use the narrator/ }))
    expect(screen.getByRole('group', { name: 'Choose what AI may identify' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Build transcript →' })).toBeEnabled()
  })

  it('ignores a persisted attribution target after its match count drops to zero', async () => {
    await open({
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] },
      dialogue: { ...base.dialogue!, attributionTargets: ['open-speakers'] },
    })

    const scopes = screen.getByRole('group', { name: 'Choose what AI may identify' })
    expect(within(scopes).getByText('None found')).toBeInTheDocument()
    expect(within(scopes).getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Build transcript →' })).toBeEnabled()
  })

  it('reopens the accepted Dialogue result with prior corrections and no AI rerun', async () => {
    const candidate = {
      revision: 'dialogue-ai', strategy: 'fill-gaps' as const, attributionTargets: ['unlabelled-candidates'] as const,
      resultSummary: { totalTurns: 1, explicitTurns: 0, aiAttributed: 1, aiContributions: 1, unresolved: 0, userCorrected: 0 },
      spans: [{ id: 'target', page: 8, source: '“We should go.”', text: 'We should go.', renderRole: 'dialogue', resolvedSpeakerLabel: 'Alice', speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2' }],
      aiWindows: [{ id: 'window-target', ownerIds: ['target'], dossiers: [{ page: 8, before: 'They reached the platform.', target: '“We should go.”', after: 'The train was waiting.' }] }],
    }
    const accepted = {
      ...candidate,
      revision: 'd1', correctedFromRevision: 'dialogue-ai',
      resultSummary: { ...candidate.resultSummary, aiAttributed: 0, aiContributions: 0, userCorrected: 1 },
      spans: [{ ...candidate.spans[0], resolvedSpeakerLabel: 'Bob', speakerStatus: 'user', origin: 'user:dialogue-speaker' }],
      userCorrections: [{ spanId: 'target', action: 'speaker', speakerLabel: 'Bob', provenance: 'user' }],
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValueOnce(accepted).mockResolvedValueOnce(candidate)
    await open({ ...base, dialogue: { ...base.dialogue!, summary: { ...base.dialogue!.summary, explicitTurns: 5, aiAttributed: 0, aiContributions: 0, userCorrected: 1, unresolved: 2 } } })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Dialogue'))

    expect(screen.getByText('Pre-labelled').closest('span')).toHaveTextContent('5')
    expect(screen.getByText('Corrected by you').closest('span')).toHaveTextContent('1')
    expect(screen.getByText('Read by narrator').closest('span')).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))

    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    expect(wizardApi.getStageCandidate).toHaveBeenNthCalledWith(1, 'book-1', 'dialogue', 'd1')
    expect(wizardApi.getStageCandidate).toHaveBeenNthCalledWith(2, 'book-1', 'dialogue', 'dialogue-ai')
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Current accepted transcript' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByRole('button', { name: /Dialogue Complete/ })).not.toHaveClass('revising')
    const accept = screen.getByRole('button', { name: 'Accept dialogue result →' })
    expect(accept).toBeDisabled()

    fireEvent.click(screen.getByRole('tab', { name: 'AI checks 1' }))
    const row = screen.getByText('“We should go.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(within(row).getByText('Your correction')).toBeInTheDocument()
    expect(row).toHaveTextContent('Bob')
    fireEvent.click(within(row).getByRole('button', { name: 'Restore AI choice' }))
    expect(accept).toBeEnabled()
    fireEvent.click(accept)

    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'dialogue', 'dialogue-ai', []))
  })

  it('shows a compact remote-model cost receipt without changing the overview grid', async () => {
    await open({
      ...base,
      dialogue: {
        ...base.dialogue!,
        remoteUsage: {
          inputTokens: 1200, cachedInputTokens: 200, outputTokens: 80,
          estimatedCostUsd: 0.42, modelProfile: 'luna-dialogue',
          modelDisplayName: 'Luna', providerModels: ['gpt-5.6-luna'],
        },
      },
    })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Dialogue'))

    const receipt = screen.getByText('Luna · ≈$0.42 API')
    expect(receipt).toHaveClass('accepted-cost-receipt')
    expect(receipt.closest('.accepted-summary-badges')).toBeInTheDocument()
    expect(document.querySelectorAll('.accepted-summary > span')).toHaveLength(4)
  })

  it('lets an embedding composition hide supplier cost receipts', async () => {
    await open({
      ...base,
      dialogue: {
        ...base.dialogue!,
        remoteUsage: {
          inputTokens: 1200, cachedInputTokens: 200, outputTokens: 80,
          estimatedCostUsd: 0.42, modelProfile: 'luna-dialogue',
          modelDisplayName: 'Luna', providerModels: ['gpt-5.6-luna'],
        },
      },
    }, undefined, undefined, undefined, { capabilities: { showProviderCostReceipts: false } })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Dialogue'))

    expect(screen.queryByText('Luna · ≈$0.42 API')).not.toBeInTheDocument()
  })

  it('refreshes routing before rebuilding a completed transcript and shows the route choice', async () => {
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'd1', strategy: 'fill-gaps', attributionTargets: ['unlabelled-candidates'], resultSummary: {}, spans: [], aiWindows: [] })
    await open(base)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Dialogue'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change strategy' }))
    expect(screen.queryByRole('region', { name: 'Current accepted transcript' })).not.toBeInTheDocument()
    vi.mocked(wizardApi.previewDialogue).mockResolvedValueOnce({
      ...base.dialogue!,
      routing: {
        targetCount: 938,
        largeReviewThreshold: 100,
        shouldPrompt: true,
        defaultRoute: 'local',
        local: { displayName: 'Qwen', apiCostUsd: 0 },
        remote: {
          displayName: 'Luna', domain: 'api.openai.com', credentialConfigured: true,
          apiKeyEnvironmentVariable: 'OPENAI_API_KEY', estimatedCostUsd: .68,
        },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))

    expect(await screen.findByRole('dialog', { name: '938 dialogue lines need a speaker check' })).toBeInTheDocument()
    expect(wizardApi.previewDialogue).toHaveBeenCalledWith('book-1', expect.objectContaining({
      attributionTargets: ['unlabelled-candidates'],
    }))
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('never silently starts Local when routing choices cannot be refreshed', async () => {
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'd1', strategy: 'fill-gaps', attributionTargets: ['unlabelled-candidates'], resultSummary: {}, spans: [], aiWindows: [] })
    await open(base)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Dialogue'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change strategy' }))
    vi.mocked(wizardApi.previewDialogue).mockResolvedValueOnce(base.dialogue!)

    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))

    expect(await screen.findByText('Speaker-check choices could not be loaded. Try again.')).toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('presents unlabelled samples as pending when their AI scope is selected', async () => {
    const dialogue = {
      ...base.dialogue!,
      regexes: [{
        ...base.dialogue!.regexes[0],
        label: 'Unlabelled straight quotation',
        examples: [{ spanId: 'straight-1', page: 4, source: '"Whew"', spokenText: 'Whew', speakerStatus: 'unlabelled' as const, origin: 'quotes' }],
      }],
    }
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue })

    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    expect(screen.getByText('Pending AI check')).toBeInTheDocument()
    expect(screen.queryByText(/Why keep this/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Will speak: Whew/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    fireEvent.click(screen.getByText('Dialogue with no speaker label'))
    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    expect(screen.getByText('Narrator will read: Whew')).toBeInTheDocument()
  })

  it('combines built-in and custom detection rules in one evidence accordion', async () => {
    const dialogue = {
      ...base.dialogue!,
      regexes: [
        ...base.dialogue!.regexes,
        { ...base.dialogue!.regexes[0], id: 'custom-stage', label: 'Stage directions', builtIn: false, matchCount: 1 },
        { ...base.dialogue!.regexes[0], id: 'unused-rule', label: 'Unused rule', matchCount: 0, examples: [] },
      ],
    }
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue })

    const rules = screen.getByRole('button', { name: 'Dialogue detection rules' })
    expect(rules).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Who reads the unresolved dialogue?')).toBeInTheDocument()
    expect(screen.queryByText('Labels that mean “speaker unknown”')).not.toBeInTheDocument()

    fireEvent.click(rules)
    expect(screen.getByText('Curly quotes')).toBeInTheDocument()
    expect(screen.getByText('Stage directions')).toBeInTheDocument()
    expect(screen.queryByText('Unused rule')).not.toBeInTheDocument()
    expect(screen.getAllByText(/built in|custom/i).length).toBeGreaterThan(1)
    expect(screen.getAllByText('“Wait,”').length).toBeGreaterThan(0)
    expect(screen.getByText('Labels that mean “speaker unknown”')).toBeInTheDocument()
    expect(screen.queryByText('Who reads the unresolved dialogue?')).not.toBeInTheDocument()

    fireEvent.click(rules)
    expect(screen.getByText('Who reads the unresolved dialogue?')).toBeInTheDocument()
  })

  it('publishes a complete extraction without an empty confirmation screen', async () => {
    const imported: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import'] },
      activeArtifacts: {},
      dialogue: undefined,
      cast: undefined,
      recordingScript: undefined,
      generatedChapters: [],
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'extract-job', status: 'succeeded', result: { revision: 'extract-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'extract-2', pageCount: 120, warnings: [] })
    vi.mocked(wizardApi.acceptStage).mockResolvedValue(undefined)
    await open(imported)
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base)

    fireEvent.click(screen.getByRole('button', { name: 'Process complete book →' }))

    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'extract', 'extract-2', []))
    expect(screen.queryByText('Complete-book extraction candidate')).not.toBeInTheDocument()
  })

  it('gates AI behind a kind group-level regex conflict review', async () => {
    const conflict: DialogueConflict = {
      id: 'conflict-1', groupId: 'profiles:inner:outer', profileIds: ['inner', 'outer'] as [string, string], page: 4,
      claims: [
        { matchId: 'inner-1', profileId: 'inner', page: 4, source: '“Come inside.”', spokenText: 'Come inside.', speakerLabel: null, contextBefore: 'Alice said, ' },
        { matchId: 'outer-1', profileId: 'outer', page: 4, source: 'Alice: “Come inside.”', spokenText: 'Come inside.', speakerLabel: 'Alice' },
      ],
    }
    const dialogue = {
      ...base.dialogue!,
      regexes: [
        { ...base.dialogue!.regexes[0], id: 'inner', label: 'Quote only' },
        { ...base.dialogue!.regexes[0], id: 'outer', label: 'Named quote' },
      ],
      summary: { ...base.dialogue!.summary, conflicts: 1 },
      conflicts: [conflict],
    }
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue })

    expect(screen.getByText('1 overlapping dialogue match needs your choice')).toBeInTheDocument()
    expect(screen.getByText('detected matches').closest('span')).toHaveTextContent('2')
    expect(screen.getByText('issue to review').closest('span')).toHaveTextContent('1')
    expect(screen.getByText('Alice said,')).toBeInTheDocument()
    expect(screen.queryByText('Who reads the unresolved dialogue?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dialogue detection rules' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Review detection rules' }))
    expect(screen.getByRole('button', { name: 'Dialogue detection rules' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('1 overlapping dialogue match needs your choice')).not.toBeInTheDocument()
    expect(screen.getByText('Quote only')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose narration for all 1 overlap' }))
    expect(screen.getByRole('button', { name: 'Choose narration for all 1 overlap' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('The narrator will read this text.')).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: 'Apply choices and continue →' })
    expect(apply).toBeEnabled()

    vi.mocked(wizardApi.previewDialogue).mockResolvedValue({
      ...dialogue,
      summary: { ...dialogue.summary, conflicts: 0 },
      conflicts: [],
      resolvedConflicts: [{ ...conflict, winnerProfileId: 'outer' }],
      conflictResolutions: [{ profileIds: ['inner', 'outer'], winnerProfileId: 'outer' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Named quote for all 1 overlap' }))
    expect(screen.getByRole('button', { name: 'Choose Named quote for all 1 overlap' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Detected speaker')).toHaveLength(2)
    expect(screen.getAllByText('Alice')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Apply choices and continue →' }))

    expect(await screen.findByText('Overlapping matches resolved')).toBeInTheDocument()
    expect(screen.getByText('Who reads the unresolved dialogue?')).toBeInTheDocument()
    expect(wizardApi.previewDialogue).toHaveBeenLastCalledWith('book-1', expect.objectContaining({
      conflictResolutions: [{ profileIds: ['inner', 'outer'], winnerProfileId: 'outer' }],
    }))
  })

  it('requires an explicit result when one labelled turn starts inside another', async () => {
    const issue: DialogueStructuralIssue = {
      id: 'issue:interrupted-turn:label-brackets:p93-b1:0-70',
      kind: 'interrupted-turn', profileId: 'label-brackets', page: 93,
      source: 'Abel: [Answer.\nSubaru: [Eh…]', contextBefore: 'and asked,\n',
      outerSpeakerLabel: 'Abel', innerSpeakerLabels: ['Subaru'],
      availableActions: ['split', 'keep-together', 'narration'],
      interpretations: {
        split: [
          { matchId: 'outer:split-1', profileId: 'label-brackets', page: 93, source: 'Abel: [Answer.\n', spokenText: 'Answer.\n', speakerLabel: 'Abel' },
          { matchId: 'outer:split-2', profileId: 'label-brackets', page: 93, source: 'Subaru: [Eh…]', spokenText: 'Eh…', speakerLabel: 'Subaru' },
        ],
        'keep-together': [{ matchId: 'outer', profileId: 'label-brackets', page: 93, source: 'Abel: [Answer.\nSubaru: [Eh…]', spokenText: 'Answer.\nSubaru: [Eh…', speakerLabel: 'Abel' }],
        narration: [],
      },
    }
    const dialogue = {
      ...base.dialogue!,
      summary: { ...base.dialogue!.summary, structuralIssues: 1 },
      structuralIssues: [issue],
    }
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue })

    expect(screen.getByText('1 interrupted dialogue turn needs your choice')).toBeInTheDocument()
    expect(screen.queryByText('Who reads the unresolved dialogue?')).not.toBeInTheDocument()
    expect(screen.getByText('and asked,')).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: 'Apply choices and continue →' })
    expect(apply).toBeDisabled()

    vi.mocked(wizardApi.previewDialogue).mockResolvedValue({
      ...dialogue,
      summary: { ...dialogue.summary, structuralIssues: 0 },
      structuralIssues: [],
      resolvedStructuralIssues: [{ ...issue, selectedAction: 'split' }],
      structuralResolutions: [{ issueId: issue.id, action: 'split' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Split into detected turns/ }))
    expect(screen.getByText('Eh…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply choices and continue →' }))

    expect(await screen.findByText('Interrupted turns resolved')).toBeInTheDocument()
    expect(screen.getByText('Who reads the unresolved dialogue?')).toBeInTheDocument()
    expect(wizardApi.previewDialogue).toHaveBeenLastCalledWith('book-1', expect.objectContaining({
      structuralResolutions: [{ issueId: issue.id, action: 'split' }],
    }))
  })

  it('keeps large overlap groups readable with four representative results', async () => {
    const conflicts: DialogueConflict[] = Array.from({ length: 6 }, (_, index) => ({
      id: `conflict-${index + 1}`, groupId: 'profiles:inner:outer', profileIds: ['inner', 'outer'] as [string, string], page: index + 4,
      claims: (index % 2 ? [
        { matchId: `outer-${index + 1}`, profileId: 'outer', page: index + 4, source: `Alice: “Line ${index + 1}.”`, spokenText: `Line ${index + 1}.`, speakerLabel: 'Alice' },
        { matchId: `inner-${index + 1}`, profileId: 'inner', page: index + 4, source: `“Line ${index + 1}.”`, spokenText: `Line ${index + 1}.`, speakerLabel: null },
      ] : [
        { matchId: `inner-${index + 1}`, profileId: 'inner', page: index + 4, source: `“Line ${index + 1}.”`, spokenText: `Line ${index + 1}.`, speakerLabel: null },
        { matchId: `outer-${index + 1}`, profileId: 'outer', page: index + 4, source: `Alice: “Line ${index + 1}.”`, spokenText: `Line ${index + 1}.`, speakerLabel: 'Alice' },
      ]) as DialogueConflict['claims'],
    }))
    const dialogue = {
      ...base.dialogue!,
      regexes: [
        { ...base.dialogue!.regexes[0], id: 'inner', label: 'Quote only' },
        { ...base.dialogue!.regexes[0], id: 'outer', label: 'Named quote' },
      ],
      summary: { ...base.dialogue!.summary, conflicts: conflicts.length },
      conflicts,
    }

    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue })

    expect(screen.getAllByLabelText(/Overlap example/)).toHaveLength(4)
    expect(screen.getByText('Showing 4 representative examples. This choice will apply to all 6 overlaps.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose Named quote for all 6 overlaps' })).toBeInTheDocument()
    for (const example of screen.getAllByLabelText(/Overlap example/)) {
      expect([...example.querySelectorAll('.conflict-interpretations > div > header > b')].map((node) => node.textContent)).toEqual(['Quote only', 'Named quote'])
    }
  })

  it('keeps an existing pair resolution when an unrelated third regex is disabled', async () => {
    const conflict: DialogueConflict = {
      id: 'conflict-1', groupId: 'profiles:inner:outer', profileIds: ['inner', 'outer'], page: 4,
      claims: [
        { matchId: 'inner-1', profileId: 'inner', page: 4, source: '“Come inside.”', spokenText: 'Come inside.', speakerLabel: null },
        { matchId: 'outer-1', profileId: 'outer', page: 4, source: 'Alice: “Come inside.”', spokenText: 'Come inside.', speakerLabel: 'Alice' },
      ],
      winnerProfileId: 'outer',
    }
    const resolution = { profileIds: ['inner', 'outer'] as [string, string], winnerProfileId: 'outer' }
    const resolvedDialogue = {
      ...base.dialogue!,
      regexes: [
        { ...base.dialogue!.regexes[0], id: 'inner', label: 'Quote only' },
        { ...base.dialogue!.regexes[0], id: 'outer', label: 'Named quote' },
        { ...base.dialogue!.regexes[0], id: 'third', label: 'Third rule' },
      ],
      conflicts: [],
      resolvedConflicts: [conflict],
      conflictResolutions: [resolution],
    }
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue: resolvedDialogue })
    vi.mocked(wizardApi.previewDialogue).mockResolvedValue({
      ...resolvedDialogue,
      regexes: resolvedDialogue.regexes.map((regex) => regex.id === 'third' ? { ...regex, enabled: false, matchCount: 0 } : regex),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Third rule 12 matches · built in' }))

    await waitFor(() => expect(wizardApi.previewDialogue).toHaveBeenLastCalledWith('book-1', expect.objectContaining({
      conflictResolutions: [resolution],
      regexes: expect.arrayContaining([expect.objectContaining({ id: 'third', enabled: false })]),
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    expect(screen.queryByText(/overlapping dialogue match needs your choice/)).not.toBeInTheDocument()
    expect(screen.getByText('Overlapping matches resolved')).toBeInTheDocument()
  })

  it('keeps the combined detection rules open while editing a custom regex', async () => {
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } })
    const rulesToggle = screen.getByRole('button', { name: 'Dialogue detection rules' })
    fireEvent.click(rulesToggle)
    fireEvent.click(screen.getByText('Add a custom detection rule'))
    expect(rulesToggle).toHaveAttribute('aria-expanded', 'true')

    const name = screen.getByLabelText('Name')
    name.focus()
    fireEvent.change(name, { target: { value: 'My dialogue format' } })

    expect(rulesToggle).toHaveAttribute('aria-expanded', 'true')
    expect(name).toHaveFocus()
    expect(name).toHaveValue('My dialogue format')
    expect(screen.getByLabelText('Regex')).toBeVisible()
    expect(screen.getByText(/Python-style named captures/)).toBeInTheDocument()
  })

  it('selects a dialogue strategy from the full card area', async () => {
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } })
    fireEvent.click(screen.getByRole('button', { name: /Use the narrator/ }).closest('.strategy-card')!)
    expect(screen.getByText('No AI speaker matching will run.')).toBeInTheDocument()

    const ai = screen.getByRole('button', { name: /Suggest speakers with AI/ })
    ai.focus()
    fireEvent.click(ai)
    expect(screen.getByRole('button', { name: /Suggest speakers with AI/ })).toHaveFocus()
  })

  it('offers a plain local-versus-remote choice for a large speaker review', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] },
      dialogue: {
        ...base.dialogue!,
        routing: {
          targetCount: 938,
          largeReviewThreshold: 100,
          shouldPrompt: true,
          defaultRoute: 'local',
          local: { displayName: 'Qwen', apiCostUsd: 0 },
          remote: {
            displayName: 'Luna', domain: 'api.openai.com', credentialConfigured: true,
            apiKeyEnvironmentVariable: 'OPENAI_API_KEY', estimatedCostUsd: .68,
            falseNamesReductionPercent: 85, speakerRecallImprovementPercent: 272,
          },
        },
      },
    }
    let finishRemoteLaunch: (job: Job) => void = () => undefined
    let finishRemotePoll: (job: Job) => void = () => undefined
    vi.mocked(wizardApi.processStage).mockImplementation(() => new Promise<Job>((resolve) => { finishRemoteLaunch = resolve }))
    vi.mocked(wizardApi.getJob).mockImplementation(() => new Promise<Job>((resolve) => { finishRemotePoll = resolve }))
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'dialogue-candidate', resultSummary: {}, spans: [] })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))

    let dialog = screen.getByRole('dialog', { name: '938 dialogue lines need a speaker check' })
    expect(dialog).toHaveFocus()
    const closeChoice = within(dialog).getByRole('button', { name: 'Close speaker-check choice' })
    closeChoice.focus()
    fireEvent.keyDown(closeChoice, { key: 'Tab', shiftKey: true })
    expect(within(dialog).getByRole('button', { name: /Luna Runs at api.openai.com/ })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(closeChoice).toHaveFocus()
    fireEvent.keyDown(closeChoice, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '938 dialogue lines need a speaker check' })).not.toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    dialog = screen.getByRole('dialog', { name: '938 dialogue lines need a speaker check' })
    expect(within(dialog).getByText('Everything stays local')).toBeInTheDocument()
    expect(within(dialog).getByText('May choose the wrong character')).toBeInTheDocument()
    expect(within(dialog).getByText('May miss a character and use Narrator')).toBeInTheDocument()
    expect(within(dialog).getByText('Privacy depends on your API provider and setup')).toBeInTheDocument()
    expect(within(dialog).getByText('≈85% fewer incorrect names')).toBeInTheDocument()
    expect(within(dialog).getByText('Likely faster for long books')).toBeInTheDocument()
    expect(dialog.querySelector('.dialogue-routing-heading svg')).toBeNull()
    const lunaTile = within(dialog).getByRole('button', { name: /Luna Runs at api.openai.com/ })
    expect(within(lunaTile).getByText('Luna').closest('.dialogue-route-head')?.querySelector('svg')).toBeTruthy()
    expect(wizardApi.processStage).not.toHaveBeenCalled()

    fireEvent.click(lunaTile)
    expect(lunaTile).toHaveAttribute('aria-pressed', 'true')
    expect(lunaTile.closest('.dialogue-routing-card')).toHaveClass('selected')
    expect(wizardApi.processStage).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Luna' }))
    expect(screen.queryByRole('dialog', { name: '938 dialogue lines need a speaker check' })).not.toBeInTheDocument()
    const processing = screen.getByRole('dialog', { name: 'Remote processing' })
    expect(processing).toHaveClass('dialogue-processing-modal')
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'dialogue', expect.objectContaining({ attributionRoute: 'remote' })))
    finishRemoteLaunch({ id: 'job-dialogue', kind: 'v2:dialogue', status: 'queued' })
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledWith('job-dialogue'))
    expect(screen.queryByRole('button', { name: 'Cancel queued job' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Remote processing' })).toHaveClass('dialogue-processing-modal')
    finishRemotePoll({ id: 'job-dialogue', kind: 'v2:dialogue', status: 'succeeded', result: { revision: 'dialogue-candidate' } })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remote processing' })).not.toBeInTheDocument())
  })

  it('keeps the local route explicit when chosen from the large-review popup', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] },
      dialogue: {
        ...base.dialogue!,
        routing: {
          targetCount: 938, largeReviewThreshold: 100, shouldPrompt: true, defaultRoute: 'local',
          local: { displayName: 'Qwen', apiCostUsd: 0 },
          remote: {
            displayName: 'Luna', domain: 'api.openai.com', credentialConfigured: true,
            apiKeyEnvironmentVariable: 'OPENAI_API_KEY', estimatedCostUsd: .68,
          },
        },
      },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-candidate' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'dialogue-candidate', resultSummary: {}, spans: [] })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    const qwenTile = screen.getByRole('button', { name: /Qwen Runs on this computer/ })
    fireEvent.click(qwenTile)
    expect(qwenTile).toHaveAttribute('aria-pressed', 'true')
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use Qwen' }))

    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'dialogue', expect.objectContaining({ attributionRoute: 'local' })))
  })

  it('uses the configured remote route without exposing local choices in an embedding composition', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] },
      dialogue: {
        ...base.dialogue!,
        routing: {
          targetCount: 938, largeReviewThreshold: 100, shouldPrompt: true, defaultRoute: 'remote',
          local: { displayName: 'Qwen', apiCostUsd: 0 },
          remote: {
            displayName: 'Luna', domain: 'api.openai.com', credentialConfigured: true,
            apiKeyEnvironmentVariable: 'OPENAI_API_KEY', estimatedCostUsd: .68,
          },
        },
      },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-candidate' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'dialogue-candidate', resultSummary: {}, spans: [] })

    await open(snapshot, undefined, undefined, undefined, { capabilities: {
      localDialogueAttribution: false,
      showExecutionBadge: false,
      showProviderCostReceipts: false,
    } })
    expect(screen.queryByText('Local-first')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))

    expect(screen.queryByRole('dialog', { name: '938 dialogue lines need a speaker check' })).not.toBeInTheDocument()
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'dialogue', expect.objectContaining({ attributionRoute: 'remote' })))
  })

  it('shows every AI-processed dialogue span without mixing in regex-owned turns', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    const aiSpans = Array.from({ length: 12 }, (_, index) => ({
      id: `ai-${index + 1}`, page: index + 1, source: `“AI source ${index + 1}”`, text: `AI source ${index + 1}`,
      renderRole: 'dialogue', sourceSpeakerLabel: null, resolvedSpeakerLabel: `Speaker ${index + 1}`,
      speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2',
    }))
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-candidate' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-candidate', resultSummary: { explicitTurns: 1, aiAttributed: 12, unresolved: 0 },
      spans: [{ id: 'regex-1', page: 4, source: 'Subaru: [Run!]', text: 'Run!', renderRole: 'dialogue', sourceSpeakerLabel: 'Subaru', speakerStatus: 'explicit', origin: 'regex:label-brackets' }, ...aiSpans],
      aiWindows: aiSpans.map((row, index) => ({ id: `window-${index + 1}`, ownerIds: [row.id], dossiers: [{ page: row.page, before: `Before ${index + 1}`, target: row.source, after: `After ${index + 1}` }] })),
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))

    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /AI checks 12/ }))
    fireEvent.click(screen.getByRole('button', { name: /Assigned 12/ }))
    expect(screen.getByRole('button', { name: /Assigned 12/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Subaru: [Run!]')).toBeInTheDocument()
    expect(screen.queryByText('Before 1')).not.toBeInTheDocument()
    const firstPageOutcomes = screen.getAllByText('Character', { selector: 'b' })
    expect(firstPageOutcomes).toHaveLength(10)
    expect(screen.getAllByText('AI assigned', { selector: '.dialogue-decision-heading > small' })).toHaveLength(10)
    expect(screen.queryByText(/qwen:targeted-speaker-v2/)).not.toBeInTheDocument()
    expect(firstPageOutcomes[0].closest('article')).toHaveTextContent('Speaker 1')
    expect(firstPageOutcomes[9].closest('article')).toHaveTextContent('Speaker 10')
    expect(screen.queryByText('Before 11')).not.toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2 · 12 lines')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    const secondPageOutcomes = screen.getAllByText('Character', { selector: 'b' })
    expect(secondPageOutcomes[0].closest('article')).toHaveTextContent('Speaker 11')
    expect(secondPageOutcomes[1].closest('article')).toHaveTextContent('Speaker 12')
    expect(screen.queryByText('Before 1')).not.toBeInTheDocument()
  })

  it('shows a modest source window and expands it within hard unit and character caps', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    const before = Array.from({ length: 9 }, (_, index) => ({
      id: `before-${index + 1}`, page: 4, source: `Before ${index + 1}.`, text: `Before ${index + 1}.`,
      renderRole: 'narration', speakerStatus: 'not-applicable', origin: 'source-partition',
    }))
    const longAfter = `AFTER_START ${'x'.repeat(1_900)} AFTER_END`
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-context' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-context', resultSummary: { explicitTurns: 0, aiAttributed: 1, unresolved: 0 },
      spans: [
        ...before,
        { id: 'target', page: 4, source: '“Target line.”', text: 'Target line.', renderRole: 'dialogue', resolvedSpeakerLabel: 'Alice', speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2' },
        { id: 'after', page: 4, source: longAfter, text: longAfter, renderRole: 'narration', speakerStatus: 'not-applicable', origin: 'source-partition' },
      ],
      aiWindows: [{ id: 'window-target', ownerIds: ['target'], dossiers: [{ page: 4, before: 'Tiny model before.', target: '“Target line.”', after: 'Tiny model after.' }] }],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    fireEvent.click(await screen.findByRole('tab', { name: /AI checks 1/ }))

    const row = (await screen.findByText('“Target line.”')).closest('article') as HTMLElement
    expect(within(row).getByText(/Before 7\. Before 8\. Before 9\./)).toBeInTheDocument()
    expect(within(row).queryByText(/Before 6\./)).not.toBeInTheDocument()
    expect(within(row).getByText(/AFTER_START/)).toBeInTheDocument()
    expect(within(row).queryByText(/AFTER_END/)).not.toBeInTheDocument()
    expect(row.querySelector('.ai-source-evidence p')?.textContent).toContain('Before 7.\n\nBefore 8.\n\nBefore 9.')

    fireEvent.click(within(row).getByRole('button', { name: 'Show more source context' }))

    expect(within(row).getByText(/Before 2\..*Before 9\./)).toBeInTheDocument()
    expect(within(row).queryByText(/Before 1\./)).not.toBeInTheDocument()
    expect(within(row).queryByText(/AFTER_END/)).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Show less source context' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('expands source context for AI decisions classified as prose', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    const before = `EARLY_CONTEXT ${'x'.repeat(700)} NEAR_CONTEXT `
    const target = '“catalogue term”'
    const after = ` AFTER_CONTEXT ${'y'.repeat(700)} LATE_CONTEXT`
    const source = `${before}${target}${after}`
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-prose-context' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-prose-context', resultSummary: { explicitTurns: 0, aiAttributed: 0, unresolved: 0 },
      spans: [{ id: 'merged-narration', blockId: 'b1', page: 4, source, text: source, renderRole: 'narration', speakerStatus: 'not-applicable', origin: 'qwen:not-vocalisation' }],
      aiWindows: [{ id: 'window-prose', ownerIds: ['prose-target'], dossiers: [{ page: 4, before: 'Tiny model before.', target, after: 'Tiny model after.' }] }],
      matches: [{ spanId: 'prose-target', blockId: 'b1', page: 4, sourceStart: before.length, sourceEnd: before.length + target.length, source: target, text: 'catalogue term' }],
      blocks: [{ id: 'b1', page: 4, text: source }],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    fireEvent.click(await screen.findByRole('tab', { name: /AI checks 1/ }))

    const row = (await screen.findByText(target, { selector: 'mark' })).closest('article') as HTMLElement
    expect(within(row).getByText('Tiny model before.')).toBeInTheDocument()
    expect(within(row).queryByText(/EARLY_CONTEXT/)).not.toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'Show more source context' }))

    expect(within(row).getByText(/EARLY_CONTEXT.*NEAR_CONTEXT/)).toBeInTheDocument()
    expect(within(row).getByText(/AFTER_CONTEXT.*LATE_CONTEXT/)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Show less source context' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('restores a durable pending Dialogue candidate without running AI again', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] },
      pendingCandidates: { dialogue: { revision: 'dialogue-pending', status: 'candidate' } },
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-pending', strategy: 'fill-gaps', attributionTargets: ['unlabelled-candidates'],
      resultSummary: { explicitTurns: 0, aiAttributed: 1, unresolved: 0 },
      spans: [{ id: 'ai-restored', page: 7, source: '“Restored.”', text: 'Restored.', renderRole: 'dialogue', sourceSpeakerLabel: null, resolvedSpeakerLabel: 'Alice', speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2' }],
      aiWindows: [{ id: 'window-restored', ownerIds: ['ai-restored'], dossiers: [{ page: 7, before: 'Alice looked up.', target: '“Restored.”', after: 'The room went quiet.' }] }],
    })

    await open(snapshot)

    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /AI checks 1/ }))
    expect(screen.getByText('“Restored.”')).toBeInTheDocument()
    expect(screen.getByText('Alice looked up.')).toBeInTheDocument()
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'dialogue', 'dialogue-pending')
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('restores a conflicted pending candidate directly into preflight review', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] },
      pendingCandidates: { dialogue: { revision: 'dialogue-conflicted', status: 'candidate' } },
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      scanVersion: 6,
      revision: 'dialogue-conflicted',
      strategy: 'fill-gaps',
      profiles: [
        { id: 'inner', label: 'Quote only', pattern: '(?P<text>.+)', priority: 1, enabled: true, custom: true, matchCount: 1, examples: [] },
        { id: 'outer', label: 'Named quote', pattern: '(?P<speaker>.+): (?P<text>.+)', priority: 2, enabled: true, custom: true, matchCount: 1, examples: [] },
      ],
      resultSummary: { regexClaims: 2, explicitTurns: 0, openSpeakerTurns: 0, unlabelledCandidates: 0, conflicts: 1 },
      conflicts: [{
        id: 'saved-conflict', groupId: 'profiles:inner:outer', profileIds: ['inner', 'outer'], page: 9,
        claims: [
          { matchId: 'saved-inner', profileId: 'inner', page: 9, source: '“Saved.”', text: 'Saved.' },
          { matchId: 'saved-outer', profileId: 'outer', page: 9, source: 'Alice: “Saved.”', text: 'Saved.', sourceSpeakerLabel: 'Alice' },
        ],
      }],
      spans: [],
    })
    vi.mocked(normalizeDialogueArtifact).mockReturnValue({
      scanVersion: 6,
      revision: 'dialogue-conflicted',
      strategy: 'fill-gaps',
      regexes: [
        { id: 'inner', label: 'Quote only', pattern: '(?P<text>.+)', priority: 1, enabled: true, builtIn: false, matchCount: 1, examples: [] },
        { id: 'outer', label: 'Named quote', pattern: '(?P<speaker>.+): (?P<text>.+)', priority: 2, enabled: true, builtIn: false, matchCount: 1, examples: [] },
      ],
      openSpeakerPatterns: [],
      summary: { totalTurns: 0, regexClaims: 2, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 1 },
      examples: [],
      conflicts: [{
        id: 'saved-conflict', groupId: 'profiles:inner:outer', profileIds: ['inner', 'outer'], page: 9,
        claims: [
          { matchId: 'saved-inner', profileId: 'inner', page: 9, source: '“Saved.”', spokenText: 'Saved.' },
          { matchId: 'saved-outer', profileId: 'outer', page: 9, source: 'Alice: “Saved.”', spokenText: 'Saved.', speakerLabel: 'Alice' },
        ],
      }],
    })

    await open(snapshot)

    expect(await screen.findByText('1 overlapping dialogue match needs your choice')).toBeInTheDocument()
    expect(screen.queryByText('Inspect AI-processed dialogue')).not.toBeInTheDocument()
    expect(screen.queryByText('Who reads the unresolved dialogue?')).not.toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('discards a stale conflicted candidate and recomputes current preflight', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] },
      pendingCandidates: { dialogue: { revision: 'dialogue-stale-conflict', status: 'candidate' } },
    }
    const staleConflict: DialogueConflict = {
      id: 'stale-conflict', groupId: 'profiles:inner:outer', profileIds: ['inner', 'outer'], page: 4,
      claims: [
        { matchId: 'inner', profileId: 'inner', page: 4, source: '“Old.”', spokenText: 'Old.' },
        { matchId: 'outer', profileId: 'outer', page: 4, source: 'Alice: “Old.”', spokenText: 'Old.', speakerLabel: 'Alice' },
      ],
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'dialogue-stale-conflict', conflicts: [staleConflict] })
    vi.mocked(normalizeDialogueArtifact).mockReturnValue({ ...base.dialogue!, scanVersion: 2, conflicts: [staleConflict] })

    await open(snapshot)

    expect(screen.queryByText(/overlapping dialogue match needs your choice/)).not.toBeInTheDocument()
    expect(screen.getByText('Who reads the unresolved dialogue?')).toBeInTheDocument()
    expect(screen.queryByText('Inspect AI-processed dialogue')).not.toBeInTheDocument()
  })

  it('reconstructs precise rejected targets and context for older saved candidates', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] },
      pendingCandidates: { dialogue: { revision: 'dialogue-old', status: 'candidate' } },
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-old', strategy: 'fill-gaps', resultSummary: { explicitTurns: 0, aiAttributed: 0, unresolved: 0 },
      spans: [{ id: 'merged-narration', blockId: 'b1', page: 4, source: 'Before “citation” after.', text: 'Before “citation” after.', renderRole: 'narration', speakerStatus: 'not-applicable', origin: 'qwen:not-vocalisation' }],
      aiWindows: [{ id: 'window-old', ownerIds: ['target-old'] }],
      matches: [{ spanId: 'target-old', blockId: 'b1', page: 4, sourceStart: 7, sourceEnd: 17, source: '“citation”', text: 'citation' }],
      blocks: [{ id: 'b1', page: 4, text: 'Before “citation” after.' }],
    })

    await open(snapshot)

    fireEvent.click(await screen.findByRole('tab', { name: 'AI checks 1' }))
    fireEvent.click(screen.getByRole('button', { name: /Not dialogue 1/ }))
    expect(await screen.findAllByText('“citation”')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Not dialogue 1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('after.')).toBeInTheDocument()
    const rejected = screen.getByText('Kept as narration', { selector: 'b' }).closest('article')
    expect(rejected).toHaveClass('rejected')
    expect(rejected).toHaveTextContent('Kept as narration')
    expect(rejected).not.toHaveTextContent('surrounding text')
    expect(rejected).not.toHaveTextContent('Before “citation” after.Before “citation” after.')
  })

  it('filters AI outcomes and sends only explicit user corrections on acceptance', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-candidate' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-candidate', resultSummary: { explicitTurns: 4, aiAttributed: 1, unresolved: 1 },
      spans: [
        { id: 'character-1', page: 1, source: '“Character line.”', text: 'Character line.', renderRole: 'dialogue', resolvedSpeakerLabel: 'Alice', speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2' },
        { id: 'narrator-1', page: 2, source: '“Narrator line.”', text: 'Narrator line.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
      ],
      aiWindows: [
        { id: 'w1', ownerIds: ['character-1'], dossiers: [{ page: 1, target: '“Character line.”' }] },
        { id: 'w2', ownerIds: ['narrator-1'], dossiers: [{ page: 2, target: '“Narrator line.”' }] },
        { id: 'w3', ownerIds: ['prose-1'], dossiers: [{ page: 3, target: '“Prose label.”' }] },
      ],
      matches: [{ spanId: 'prose-1', blockId: 'prose-block', page: 3, sourceStart: 7, sourceEnd: 21, source: '“Prose label.”', text: 'Prose label.' }],
      blocks: [{ id: 'prose-block', page: 3, text: 'Before “Prose label.” after.' }],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'AI checks 3' }))

    const resultFilters = within(screen.getByRole('group', { name: 'Filter AI results' })).getAllByRole('button')
    expect(resultFilters.map((button) => button.textContent)).toEqual([
      'All3', 'Assigned1', 'Needs review1', 'Not dialogue1',
    ])
    expect(screen.getByRole('button', { name: /All 3/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Needs review 1/ }))
    expect(screen.getByText('“Narrator line.”', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.queryByText('“Character line.”', { selector: 'mark' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Not dialogue 1/ }))
    expect(screen.getAllByText('“Prose label.”')).toHaveLength(1)
    expect(screen.queryByText('“Character line.”')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /All 3/ }))
    const narratorRow = screen.getByText('“Narrator line.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(screen.getByRole('button', { name: /Needs review 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Not dialogue 1/ })).toBeInTheDocument()
    expect(within(narratorRow).getByText('Needs review · no clear speaker')).toBeInTheDocument()
    expect(within(narratorRow).getByText('Narrator for now', { selector: 'b' })).toBeInTheDocument()
    expect(within(narratorRow).getByText('Choose a character if you know who spoke', { selector: '.dialogue-change-choices > small' })).toBeInTheDocument()
    expect(within(narratorRow).queryByRole('button', { name: 'Choose Narrator' })).not.toBeInTheDocument()
    expect(within(narratorRow).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    fireEvent.click(within(narratorRow).getByRole('button', { name: 'Choose another character' }))
    const characterInput = within(narratorRow).getByLabelText('Character name')
    expect(characterInput).toHaveValue('')
    expect(characterInput).toHaveAttribute('placeholder', 'Search or type a character name')
    fireEvent.change(characterInput, { target: { value: 'Alice' } })
    expect(within(narratorRow).getByText('Needs review · no clear speaker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Needs review 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assigned 1/ })).toBeInTheDocument()
    fireEvent.click(within(narratorRow).getByRole('button', { name: 'Apply change' }))
    expect(within(narratorRow).getByText('Your correction')).toBeInTheDocument()
    expect(within(narratorRow).getByText('Change reader', { selector: '.dialogue-change-choices > small' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Needs review 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assigned 1/ })).toBeInTheDocument()

    const characterRow = screen.getByText('“Character line.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(within(characterRow).getByText('Change reader', { selector: '.dialogue-change-choices > small' })).toBeInTheDocument()
    expect(within(characterRow).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    fireEvent.click(within(characterRow).getByRole('button', { name: 'Choose Narrator' }))

    expect(within(characterRow).getByText('Your correction')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assigned 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Needs review 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Not dialogue 1/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Accept dialogue result →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith(
      'book-1',
      'dialogue',
      'dialogue-candidate',
      [
        { spanId: 'character-1', action: 'narrator', provenance: 'user' },
        { spanId: 'narrator-1', action: 'speaker', speakerLabel: 'Alice', provenance: 'user' },
      ],
    ))
  })

  it('uses the shared suggestion review for local attribution disagreements', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-suggested' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-suggested', resultSummary: { explicitTurns: 0, aiAttributed: 0, unresolved: 2, aiSuggestedForReview: 2 },
      spans: [
        { id: 'suggested-1', page: 8, source: '“We should go.”', text: 'We should go.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
        { id: 'suggested-2', page: 9, source: '“Wait here.”', text: 'Wait here.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
      ],
      aiWindows: [
        { id: 'w1', ownerIds: ['suggested-1'], dossiers: [{ page: 8, target: '“We should go.”' }] },
        { id: 'w2', ownerIds: ['suggested-2'], dossiers: [{ page: 9, target: '“Wait here.”' }] },
      ],
      attributionChecks: [
        { spanId: 'suggested-1', firstPass: 'Alice', secondPass: 'Bob', final: '?', outcome: 'withheld', suggestedSpeakers: ['Alice', 'Bob'] },
        { spanId: 'suggested-2', firstPass: 'Alice', secondPass: '?', final: '?', outcome: 'withheld', suggestedSpeakers: ['Alice'] },
      ],
      matches: [{ spanId: 'suggested-1', blockId: 'b1', page: 8, sourceStart: 8, sourceEnd: 23, source: '“We should go.”', text: 'We should go.' }],
      blocks: [{ id: 'b1', page: 8, text: 'Before. “We should go.” After.' }],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'AI checks 2' }))
    fireEvent.click(screen.getByRole('button', { name: /Needs review 2/ }))

    expect(screen.getByRole('button', { name: /Needs review 2/ })).toHaveAttribute('aria-pressed', 'true')

    const first = screen.getByText('“We should go.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(within(first).getByText('Needs review · two possible readers')).toBeInTheDocument()
    expect(within(first).getByText('Narrator for now')).toBeInTheDocument()
    expect(within(first).getByText('Suggested readers', { selector: '.dialogue-change-choices > small' })).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Choose Alice' })).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Choose another character' })).toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: 'Choose Narrator' })).not.toBeInTheDocument()
    expect(within(first).queryByText(/surrounding text/i)).not.toBeInTheDocument()
    expect(within(first).queryByText('We should go.', { selector: '.ai-spoken-text' })).not.toBeInTheDocument()
    fireEvent.click(within(first).getByRole('button', { name: 'Choose Bob' }))

    expect(screen.getByRole('button', { name: /Needs review 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assigned 0/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept dialogue result →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith(
      'book-1',
      'dialogue',
      'dialogue-suggested',
      [{ spanId: 'suggested-1', action: 'speaker', speakerLabel: 'Bob', provenance: 'user' }],
    ))
  })

  it('starts with a calm global overview and reviews only uncertain lines', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-guided-review' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-guided-review', resultSummary: { explicitTurns: 8, aiAttributed: 1, unresolved: 2, aiSuggestedForReview: 1 },
      spans: [
        { id: 'known-1', page: 1, source: 'Emilia: “Good morning.”', text: 'Good morning.', renderRole: 'dialogue', sourceSpeakerLabel: 'Emilia', resolvedSpeakerLabel: 'Emilia', speakerStatus: 'explicit', origin: 'regex:label-brackets' },
        { id: 'known-2', page: 1, source: 'Emilia: “Ready?”', text: 'Ready?', renderRole: 'dialogue', sourceSpeakerLabel: 'Emilia', resolvedSpeakerLabel: 'Emilia', speakerStatus: 'explicit', origin: 'regex:label-brackets' },
        ...['Abel', 'Beatrice', 'Crusch', 'Felt', 'Garfiel', 'Rem'].map((label, index) => ({ id: `known-extra-${index}`, page: 1, source: `${label}: “Hello.”`, text: 'Hello.', renderRole: 'dialogue' as const, sourceSpeakerLabel: label, resolvedSpeakerLabel: label, speakerStatus: 'explicit', origin: 'regex:label-brackets' })),
        { id: 'accepted-1', page: 2, source: '“Certainly.”', text: 'Certainly.', renderRole: 'dialogue', resolvedSpeakerLabel: 'Emilia', speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2' },
        { id: 'suggested-1', page: 8, source: '“We should go.”', text: 'We should go.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
        { id: 'unsure-1', page: 9, source: '“Wait here.”', text: 'Wait here.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
      ],
      aiWindows: [
        { id: 'w0', ownerIds: ['accepted-1'], dossiers: [{ page: 2, before: 'Alice nodded.', target: '“Certainly.”', after: 'She closed the door.' }] },
        { id: 'w1', ownerIds: ['suggested-1'], dossiers: [{ page: 8, before: 'They reached the platform.', target: '“We should go.”', after: 'The train was waiting.' }] },
        { id: 'w2', ownerIds: ['unsure-1'], dossiers: [{ page: 9, before: 'A voice came from behind.', target: '“Wait here.”', after: 'No one moved.' }] },
      ],
      attributionChecks: [
        { spanId: 'accepted-1', firstPass: 'Emilia', secondPass: 'Emilia', final: 'Emilia', outcome: 'agreed', suggestedSpeakers: [] },
        { spanId: 'suggested-1', firstPass: 'Alice', secondPass: 'Bob', final: '?', outcome: 'withheld', suggestedSpeakers: ['Alice', 'Bob'] },
        { spanId: 'unsure-1', firstPass: '?', secondPass: '?', final: '?', outcome: 'withheld', suggestedSpeakers: [] },
      ],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')

    const overview = screen.getByRole('region', { name: 'Dialogue overview' })
    expect(screen.getByText('Your transcript is ready')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Dialogue assignment summary' }).querySelectorAll('i')).toHaveLength(3)
    expect(within(overview).getByText('By reader')).toBeInTheDocument()
    const emilia = within(overview).getByText('Emilia').closest('.dialogue-reader-card') as HTMLElement
    expect(emilia).toHaveTextContent('3')
    expect(within(emilia).getByRole('img', { name: '2 known · 1 AI' })).toBeInTheDocument()
    expect(within(overview).queryByText('Rem')).not.toBeInTheDocument()
    fireEvent.click(within(overview).getByRole('button', { name: 'Show 4 more readers ↓' }))
    expect(within(overview).getByText('Rem')).toBeInTheDocument()
    expect(within(overview).queryByText('“We should go.”')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Review 2/ }))
    expect(screen.getByRole('tab', { name: /Review 2/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Line 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Uncertain lines · suggested speakers first')).toBeInTheDocument()
    expect(screen.getByText('Two possible readers')).toBeInTheDocument()
    expect(screen.getByText('AI could not safely choose between them.')).toBeInTheDocument()
    expect(screen.getByText('“We should go.”', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.queryByText('“Wait here.”', { selector: 'mark' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText('Line 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('No clear speaker')).toBeInTheDocument()
    expect(screen.getByText('“Wait here.”', { selector: 'mark' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText('Review complete')).toBeInTheDocument()
    expect(screen.getByText('Accept your choices below, or inspect all AI checks.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'AI checks 3' }))
    expect(screen.getByText('“Certainly.”', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByText('“We should go.”', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByText('“Wait here.”', { selector: 'mark' })).toBeInTheDocument()
  })

  it('offers one typeable character field for existing and new names', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-manual-speaker' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-manual-speaker', resultSummary: { explicitTurns: 0, aiAttributed: 1, unresolved: 1 },
      spans: [
        { id: 'known', page: 1, source: '“Known.”', text: 'Known.', renderRole: 'dialogue', resolvedSpeakerLabel: 'Alice', speakerStatus: 'ai', origin: 'qwen:targeted-speaker-v2' },
        { id: 'target', page: 2, source: '“New voice.”', text: 'New voice.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
      ],
      aiWindows: [
        { id: 'w-known', ownerIds: ['known'], dossiers: [{ page: 1, target: '“Known.”' }] },
        { id: 'w-target', ownerIds: ['target'], dossiers: [{ page: 2, target: '“New voice.”' }] },
      ],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'AI checks 2' }))
    fireEvent.click(await screen.findByRole('button', { name: /All 2/ }))

    const target = screen.getByText('“New voice.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(within(target).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    fireEvent.click(within(target).getByRole('button', { name: 'Choose another character' }))
    const characterInput = within(target).getByLabelText('Character name')
    expect(characterInput).toHaveAttribute('role', 'combobox')
    expect(characterInput).toHaveAttribute('placeholder', 'Search or type a character name')
    expect(within(target).getByRole('option', { name: 'Alice' })).toBeInTheDocument()
    fireEvent.change(characterInput, { target: { value: 'Guest' } })
    expect(within(target).queryByRole('option', { name: 'Alice' })).not.toBeInTheDocument()
    fireEvent.change(characterInput, { target: { value: 'A' } })
    expect(within(target).getByRole('option', { name: 'Alice' })).toBeInTheDocument()
    fireEvent.change(characterInput, { target: { value: 'Guest speaker' } })
    expect(within(target).getByText('Needs review · no clear speaker')).toBeInTheDocument()
    fireEvent.click(within(target).getByRole('button', { name: 'Apply change' }))

    expect(within(target).getByText('Your correction')).toBeInTheDocument()
    expect(target).toHaveTextContent('Character · Guest speaker')
    fireEvent.click(screen.getByRole('button', { name: 'Accept dialogue result →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith(
      'book-1',
      'dialogue',
      'dialogue-manual-speaker',
      [{ spanId: 'target', action: 'speaker', speakerLabel: 'Guest speaker', provenance: 'user' }],
    ))
  })

  it('keeps narrator fallbacks implicit and applies a suggested reader in one click', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] as WizardStage[] } }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'job-dialogue', status: 'succeeded', result: { revision: 'dialogue-quick-narrator' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'dialogue-quick-narrator', resultSummary: { explicitTurns: 0, aiAttributed: 0, unresolved: 2, aiSuggestedForReview: 1 },
      spans: [
        { id: 'suggested-1', page: 8, source: '“We should go.”', text: 'We should go.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
        { id: 'unsure-1', page: 9, source: '“Wait here.”', text: 'Wait here.', renderRole: 'dialogue', speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2' },
      ],
      aiWindows: [
        { id: 'w1', ownerIds: ['suggested-1'], dossiers: [{ page: 8, target: '“We should go.”' }] },
        { id: 'w2', ownerIds: ['unsure-1'], dossiers: [{ page: 9, target: '“Wait here.”' }] },
      ],
      attributionChecks: [
        { spanId: 'suggested-1', firstPass: 'Alice', secondPass: '?', final: '?', outcome: 'withheld', suggestedSpeakers: ['Alice'] },
      ],
    })

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'AI checks 2' }))

    const suggested = screen.getByText('“We should go.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(within(suggested).queryByRole('button', { name: 'Choose Narrator' })).not.toBeInTheDocument()
    fireEvent.click(within(suggested).getByRole('button', { name: 'Choose Alice' }))
    expect(screen.getByRole('button', { name: /Needs review 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assigned 0/ })).toBeInTheDocument()

    const unsure = screen.getByText('“Wait here.”', { selector: 'mark' }).closest('article') as HTMLElement
    expect(within(unsure).queryByRole('button', { name: 'Choose Narrator' })).not.toBeInTheDocument()
    expect(within(unsure).getByRole('button', { name: 'Choose another character' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Accept dialogue result →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith(
      'book-1',
      'dialogue',
      'dialogue-quick-narrator',
      [{ spanId: 'suggested-1', action: 'speaker', speakerLabel: 'Alice', provenance: 'user' }],
    ))
  })

  it('explains narrator-read behavior when no dialogue format is detected', async () => {
    const noDialogue: WizardSnapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue: { ...base.dialogue!, regexes: [], summary: { totalTurns: 0, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 0 } } }
    await open(noDialogue)
    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    expect(screen.getByText('No likely dialogue was detected.')).toBeInTheDocument()
    expect(screen.getByText(/narrator will read any text without a matching dialogue format/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    expect(screen.getByText('No AI speaker matching will run.')).toBeInTheDocument()
  })

  it('loads the deterministic dialogue preview when extraction is accepted', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] },
      activeArtifacts: { extraction: 'e1' },
      dialogue: undefined,
      cast: undefined,
      recordingScript: undefined,
      generatedChapters: [],
    }
    vi.mocked(wizardApi.previewDialogue).mockResolvedValue(base.dialogue!)

    await open(snapshot)

    fireEvent.click(screen.getByRole('button', { name: 'Dialogue detection rules' }))
    expect(await screen.findByText('Curly quotes')).toBeInTheDocument()
    expect(wizardApi.previewDialogue).toHaveBeenCalledWith('book-1', expect.objectContaining({
      regexes: [], strategy: 'fill-gaps',
    }))
  })

  it('shows the host import limit and rejects an oversized replacement before sending it', async () => {
    render(<App maxImportBytes={10_000_000} />)
    expect(screen.getByText('Up to 10 MB')).toBeInTheDocument()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['small'], 'small.pdf')] } })
    const oversized = new File(['synthetic'], 'large.pdf')
    Object.defineProperty(oversized, 'size', { value: 10_000_001 })
    fireEvent.change(screen.getByLabelText('Choose another file'), { target: { files: [oversized] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import book →' }))
    expect(await screen.findByText('Choose a file no larger than 10 MB.')).toBeInTheDocument()
    expect(wizardApi.importBook).not.toHaveBeenCalled()
    const boundary = new File(['synthetic'], 'boundary.pdf')
    Object.defineProperty(boundary, 'size', { value: 10_000_000 })
    vi.mocked(wizardApi.importBook).mockRejectedValueOnce(new Error('Synthetic parser response'))
    fireEvent.change(screen.getByLabelText('Choose another file'), { target: { files: [boundary] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import book →' }))
    await waitFor(() => expect(wizardApi.importBook).toHaveBeenCalledExactlyOnceWith(boundary))
    expect(screen.queryByText('Choose a file no larger than 10 MB.')).not.toBeInTheDocument()
  })

  it('keeps the standalone import ceiling at 500 MB', () => {
    render(<App />)
    expect(screen.getByText('Up to 500 MB')).toBeInTheDocument()
  })

  it('adds an imported book to the local library without a second collection request', async () => {
    const imported = { id: 'book-1', title: 'Alice', source_name: 'alice.pdf', source_kind: 'pdf', page_count: 120 }
    vi.mocked(wizardApi.importBook).mockResolvedValue({ book: imported, representativePages: [{ page: 1, reason: 'opening' }], duplicate: false })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({
      ...base,
      book: { ...base.book, completedStages: ['import'] },
    })
    vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })

    render(<App />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(input!, { target: { files: [new File(['pdf'], 'alice.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import book →' }))
    await screen.findByRole('navigation', { name: 'Wizard stages' })
    expect(screen.getByRole('heading', { name: 'Check the extracted text' })).toBeInTheDocument()
    expect(screen.getByText('Step 1 · Extract')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }))

    expect(await screen.findByText('Your local books')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start another book' })).toBeInTheDocument()
    expect(screen.queryByText('Ready to begin')).not.toBeInTheDocument()
    expect(wizardApi.listBooks).toHaveBeenCalledTimes(1)
  })

  it.each([null, '', 'alice.pdf'])('restores a dialogue-stage book after remount with source filename %s', async (sourceName) => {
    vi.mocked(wizardApi.listBooks).mockResolvedValue([{ id: 'book-1', title: 'Alice', source_name: sourceName, source_kind: 'pdf', page_count: 120 }])
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({
      ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' }, cast: undefined, recordingScript: undefined,
      generatedChapters: [],
    })
    vi.mocked(wizardApi.getRepresentativePages).mockResolvedValue([{ page: 1, reason: 'opening' }])
    vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })
    const first = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alice.*Continue/ }))
    await screen.findByRole('navigation', { name: 'Wizard stages' })
    first.unmount()
    render(<App />)
    await screen.findByRole('navigation', { name: 'Wizard stages' })
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledTimes(2)
    expect(wizardApi.importBook).not.toHaveBeenCalled()
    expect(screen.getByText('Step 3 · Review')).toBeInTheDocument()
  })

  it('loads a replacement gateway and ignores the previous pending book list', async () => {
    let finishPrevious!: (value: Awaited<ReturnType<typeof wizardApi.listBooks>>) => void
    const previous = Object.create(wizardApi) as WorkflowGateway
    previous.listBooks = vi.fn(() => new Promise<Awaited<ReturnType<typeof wizardApi.listBooks>>>(resolve => { finishPrevious = resolve }))
    const current = Object.create(wizardApi) as WorkflowGateway
    current.listBooks = vi.fn().mockResolvedValue([{ id: 'current', title: 'Current book', source_name: null, source_kind: 'pdf', page_count: 120 }])
    const view = render(<App gateway={previous} />)
    view.rerender(<App gateway={current} />)
    expect(await screen.findByRole('button', { name: /Current book.*Continue/ })).toBeEnabled()
    finishPrevious([{ id: 'old', title: 'Previous book', source_name: 'old.pdf', source_kind: 'pdf', page_count: 120 }])
    await waitFor(() => expect(screen.queryByText('Loading books…')).not.toBeInTheDocument())
    expect(screen.queryByText('Previous book')).not.toBeInTheDocument()
    expect(screen.getByText('Current book')).toBeInTheDocument()
    expect(current.listBooks).toHaveBeenCalledTimes(1)
  })

  it('shows a failed working-book load and lets the user retry without reimporting', async () => {
    let finishRetry!: (value: Awaited<ReturnType<typeof wizardApi.listBooks>>) => void
    vi.mocked(wizardApi.listBooks).mockRejectedValueOnce(new Error('Offline')).mockImplementationOnce(() => new Promise(resolve => { finishRetry = resolve }))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Your books could not be loaded. Try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading books…')
    finishRetry([{ id: 'book-1', title: 'Alice', source_name: null, source_kind: 'pdf', page_count: 120 }])
    expect(await screen.findByRole('button', { name: /Alice.*Continue/ })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading books…')).not.toBeInTheDocument()
    expect(wizardApi.listBooks).toHaveBeenCalledTimes(2)
  })

  it('shows working storage and explains deletion without touching Library exports', async () => {
    vi.mocked(wizardApi.listBooks).mockResolvedValue([{ id: 'book-1', title: 'Alice', source_name: 'alice.pdf', source_kind: 'pdf', page_count: 120, asset_size_bytes: 12 * 1024 * 1024 }])
    vi.mocked(wizardApi.deleteBook).mockResolvedValue(undefined)

    render(<App />)

    await screen.findByRole('heading', { name: 'Your local books' })
    await waitFor(() => expect(wizardApi.listBookJobs).toHaveBeenCalledWith('book-1'))
    expect(screen.getByRole('heading', { name: 'Your local books' })).toBeInTheDocument()
    expect(screen.getAllByText('12.0 MiB used')).toHaveLength(1)
    expect(screen.getByText('120 pages · 12.0 MiB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alice' }))
    expect(screen.getByRole('dialog', { name: 'Delete “Alice”?' })).toHaveTextContent('source file, extracted text, dialogue and cast choices, chapter audio, and saved progress')
    expect(screen.getByRole('dialog', { name: 'Delete “Alice”?' })).toHaveTextContent('Finished exports stay in Library.')

    fireEvent.click(screen.getByRole('button', { name: 'Delete working files' }))
    await waitFor(() => expect(wizardApi.deleteBook).toHaveBeenCalledWith('book-1'))
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('keeps five-plus working books in one counted shelf', async () => {
    vi.mocked(wizardApi.listBooks).mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
      id: `book-${index + 1}`, title: `Book ${index + 1}`, source_name: `book-${index + 1}.pdf`,
      source_kind: 'pdf', page_count: 100 + index, asset_size_bytes: 1024 * 1024,
    })))

    render(<App />)

    await screen.findByText('6 books')
    await waitFor(() => expect(wizardApi.listBookJobs).toHaveBeenCalledTimes(6))
    expect(screen.getByText('6 books')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start another book' })).toBeInTheDocument()
    expect(screen.getByText('6.0 MiB used')).toBeInTheDocument()
    expect(document.querySelectorAll('.recent-books article')).toHaveLength(6)
  })

  it('keeps playable audio clear without exposing provenance receipts', async () => {
    await open()
    const chapter = screen.getByRole('heading', { name: 'Down the Rabbit-Hole' }).closest<HTMLElement>('.chapter-card')!
    expect(within(chapter).getByText('Generated')).toBeInTheDocument()
    expect(within(chapter).getByRole('button', { name: 'Listen to Down the Rabbit-Hole' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open WAV/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Revision audio-1 · current')).not.toBeInTheDocument()
    expect(screen.queryByText('Details for Down the Rabbit-Hole')).not.toBeInTheDocument()
    expect(screen.queryByText('d1')).not.toBeInTheDocument()
  })

  it('summarizes an accepted Review without exposing internal receipt ids', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      reviewInspection: {
        decisions: [{ occurrenceIds: ['warning-1'], action: 'narrate', provenance: 'user' }],
        boundaryDecisions: [{ boundaryId: 'boundary-1', action: 'chapter-start' }],
        consequences: {},
        history: [{ revision: 'review-candidate', status: 'candidate' }, { revision: 'r1', status: 'accepted' }],
      },
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(screen.getByText('Issues resolved').closest('span')).toHaveTextContent('1')
    expect(screen.getByText('Chapters confirmed').closest('span')).toHaveTextContent('1')
    expect(screen.getByText('Your accepted version stays in use until you approve a replacement.')).toBeInTheDocument()
    expect(screen.queryByText(/boundary-1|review-candidate|revision r1/)).not.toBeInTheDocument()
  })

  it('uses one concise launch action for Cast', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] as WizardStage[] }, cast: undefined, generatedChapters: [] }
    await open(snapshot)
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    fireEvent.click(within(nav).getByText('Cast & voices'))
    expect(screen.getByRole('button', { name: 'Find characters →' }).closest('.stage-launch')).toBeInTheDocument()
    expect(screen.queryByText('Ready when you are')).not.toBeInTheDocument()
  })

  it('recovers an unavailable draft model and language on the first casting visit', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      castingPreviewAvailable: true,
      cast: { revision: 'cp', phase: 'identity-review', dossiers: [], proposals: [], voiceModel: 'retired-model', language: 'retired-language' },
      voiceModels: [{ id: 'studio', label: 'Studio', supportedLanguages: ['english', 'french'] }],
      voiceSelection: { modelId: 'retired-model', language: 'retired-language' },
    }
    vi.mocked(wizardApi.previewCasting!).mockImplementation(async (_book, settings) => {
      if (settings.voiceModel !== 'studio' || !['english', 'french'].includes(settings.language ?? '')) throw new Error('Unsupported casting selection')
      return { sources: [], fingerprint: `quote-${settings.language}`, exactMatchCount: 0, totalVoiceCount: 1, remainingVoiceCount: 1, currency: 'EUR', options: [{ modelId: 'studio', label: 'Studio', description: 'Expressive voices', estimatedCostMinor: 100 }] }
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Narration language' }), { target: { value: 'french' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled())
    expect(wizardApi.previewCasting).toHaveBeenCalledWith('book-1', expect.objectContaining({ voiceModel: 'studio', language: 'french' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()

    let finishQuote!: (preview: Awaited<ReturnType<NonNullable<typeof wizardApi.previewCasting>>>) => void
    vi.mocked(wizardApi.previewCasting!).mockImplementation(() => new Promise((resolve) => { finishQuote = resolve }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Narration language' }), { target: { value: 'english' } })
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled()
    await waitFor(() => expect(finishQuote).toBeDefined())
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled()
    finishQuote({ sources: [], fingerprint: 'quote-english', exactMatchCount: 0, totalVoiceCount: 1, remainingVoiceCount: 1, currency: 'EUR', options: [{ modelId: 'studio', label: 'Studio', description: 'Expressive voices', estimatedCostMinor: 100 }] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled())
  })

  it('retains casting choices when the initial cost request fails', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      castingPreviewAvailable: true,
      cast: { revision: 'cp', phase: 'identity-review', dossiers: [], proposals: [] },
      voiceModels: [{ id: 'qwen', label: 'Studio', supportedLanguages: ['english'] }, { id: 'native', label: 'Native', supportedLanguages: ['japanese'] }],
    }
    vi.mocked(wizardApi.previewCasting!).mockImplementation(async (_book, settings) => {
      if (settings.voiceModel === 'qwen') throw new Error('Quote temporarily unavailable')
      return { sources: [], fingerprint: 'native-quote', exactMatchCount: 0, totalVoiceCount: 1, remainingVoiceCount: 1, currency: 'EUR', options: [{ modelId: 'native', label: 'Native', description: 'Natural voices', estimatedCostMinor: 100 }] }
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t calculate casting cost.')
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Native/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Narration language' }), { target: { value: 'japanese' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(wizardApi.previewCasting).toHaveBeenCalledWith('book-1', expect.objectContaining({ voiceModel: 'native', language: 'japanese' }))
  })

  it('builds a zero-target hosted transcript without an AI route', async () => {
    const dialogue = { ...base.dialogue!, regexes: [], summary: { totalTurns: 0, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 0 } }
    const preview = vi.fn().mockResolvedValue(dialogue)
    const gateway = Object.assign(Object.create(wizardApi) as typeof wizardApi, { previewDialogue: preview })
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'zero-transcript', status: 'failed', error: 'test stop' })
    await open({ ...base, book: { ...base.book, completedStages: ['import', 'extract'] }, dialogue }, undefined, undefined, undefined, { gateway, capabilities: { localDialogueAttribution: false } })
    preview.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Build transcript →' }))
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'dialogue', expect.objectContaining({ strategy: 'narrate', attributionTargets: [], attributionRoute: 'local' })))
    expect(preview).not.toHaveBeenCalled()
    expect(screen.queryByText('Speaker-check choices could not be loaded. Try again.')).not.toBeInTheDocument()
  })

  it('returns scroll and keyboard focus to the start of a newly navigated step', async () => {
    await open()
    vi.mocked(window.scrollTo).mockClear()
    const wizard = within(screen.getByRole('navigation', { name: 'Wizard stages' }))
    fireEvent.click(wizard.getByText('Cast & voices'))
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, left: 0, behavior: 'instant' })
    expect(screen.getByRole('main')).toHaveFocus()
    vi.mocked(window.scrollTo).mockClear()
    fireEvent.click(wizard.getByText('Cast & voices'))
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('enables casting after confirming the unchanged initial language once its quote is ready', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      castingPreviewAvailable: true,
      cast: { revision: 'cp', phase: 'identity-review', dossiers: [], proposals: [] },
    }
    vi.mocked(wizardApi.previewCasting!).mockResolvedValue({
      sources: [], fingerprint: 'initial-english-quote', exactMatchCount: 0, totalVoiceCount: 1,
      remainingVoiceCount: 1, currency: 'EUR',
      options: [{ modelId: 'qwen', label: 'Studio', description: 'Expressive voices', estimatedCostMinor: 150 }],
    })
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'cast-job', status: 'failed', error: 'test stop' })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    await screen.findByText('≈ €1.50')
    expect(screen.getByRole('combobox', { name: 'Narration language' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled()
    expect(wizardApi.previewCasting).toHaveBeenCalledWith('book-1', expect.objectContaining({ language: 'english' }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Narration language' }), { target: { value: 'english' } })
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled()
    expect(wizardApi.previewCasting).toHaveBeenCalledTimes(1)
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'cast',
      expect.objectContaining({ language: 'english', castingPreviewFingerprint: 'initial-english-quote' })))
  })

  it('uses host casting choices and submits selected sources only on Continue', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      castingPreviewAvailable: true,
      cast: { revision: 'cp', phase: 'identity-review', dossiers: [], proposals: [] },
    }
    vi.mocked(wizardApi.previewCasting!).mockResolvedValue({
      sources: [{ bookId: 'earlier', title: 'Earlier book', voiceCount: 2 }],
      fingerprint: 'preview-bound', exactMatchCount: 1, totalVoiceCount: 1, remainingVoiceCount: 0, currency: 'EUR',
      options: [{ modelId: 'qwen', label: 'Studio', description: 'Expressive voices', estimatedCostMinor: 0 }],
    })
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'cast-job', status: 'failed', error: 'test stop' })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.queryByLabelText('Voice model')).not.toBeInTheDocument()
    expect(wizardApi.previewCasting).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    expect(screen.getByRole('heading', { name: 'Design the voices' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Cast members' })).not.toBeInTheDocument()
    expect(screen.queryByText('Cast structure is ready')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Narration language' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Narration language' }), { target: { value: 'english' } })
    fireEvent.click(screen.getByRole('button', { name: '← Back to cast' }))
    expect(screen.getByRole('region', { name: 'Cast members' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    expect(screen.getByRole('combobox', { name: 'Narration language' })).toHaveValue('english')
    fireEvent.click(await screen.findByRole('button', { name: /Reuse voices/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Earlier book/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '← Back to cast' }))
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled()
    expect(await screen.findByRole('checkbox', { name: /Earlier book/ })).toBeChecked()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled())
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'cast', expect.objectContaining({ sourceBookIds: ['earlier'], castingPreviewFingerprint: 'preview-bound' })))
  })

  it('allows reuse as the only cast edit and clears it when those edits are cancelled', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      castingPreviewAvailable: true,
      cast: { ...base.cast!, phase: 'audition-review', language: 'english', voiceModel: 'qwen' },
    }
    vi.mocked(wizardApi.previewCasting!).mockResolvedValue({
      sources: [{ bookId: 'earlier', title: 'Earlier book', voiceCount: 2 }],
      fingerprint: 'edit-reuse', exactMatchCount: 1, totalVoiceCount: 1, remainingVoiceCount: 0, currency: 'EUR',
      options: [{ modelId: 'qwen', label: 'Studio', description: 'Expressive voices', estimatedCostMinor: 0 }],
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: '← Edit cast' }))
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    fireEvent.click(await screen.findByRole('button', { name: /Reuse voices/ }))
    expect(screen.getByRole('button', { name: 'Apply cast edits →' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Earlier book/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply cast edits →' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '← Back to cast' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel cast edits' }))
    fireEvent.click(screen.getByRole('button', { name: '← Edit cast' }))
    fireEvent.click(screen.getByRole('button', { name: 'Design the voices →' }))
    fireEvent.click(await screen.findByRole('button', { name: /Reuse voices/ }))
    expect(screen.getByRole('checkbox', { name: /Earlier book/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Apply cast edits →' })).toBeDisabled()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('resumes enhanced voice design with the saved explicit language', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      castingPreviewAvailable: true,
      cast: { revision: 'cp-resume', phase: 'identity-review', dossiers: [], proposals: [], detectedLanguage: 'english' },
      voiceModels: [{ id: 'qwen', label: 'Studio', supportedLanguages: ['english', 'french'] }],
      recoverableStages: { cast: { attempt: 1, message: 'Saved', proposalRevision: 'cp-resume', modelId: 'qwen', language: 'french' } },
    }
    vi.mocked(wizardApi.previewCasting!).mockResolvedValue({
      sources: [], fingerprint: 'resumed', exactMatchCount: 0, totalVoiceCount: 1, remainingVoiceCount: 1, currency: 'EUR',
      options: [{ modelId: 'qwen', label: 'Studio', description: 'Expressive voices', estimatedCostMinor: 100 }],
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.getByRole('heading', { name: 'Design the voices' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Narration language' })).toHaveValue('french')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue voice generation →' })).toBeEnabled())
    expect(wizardApi.previewCasting).toHaveBeenCalledWith('book-1', expect.objectContaining({ language: 'french' }))
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('restores a failed cast model and offers to continue saved voice generation', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r1' },
      cast: {
        revision: 'cast-proposal-1', phase: 'identity-review', dossiers: [], proposals: [],
        detectedLanguage: 'english',
      },
      voiceModels: [
        { id: 'qwen3', label: 'Qwen3', supportedLanguages: ['english'] },
        { id: 'qwen-audio', label: 'Qwen Audio', supportedLanguages: ['english'] },
      ],
      voiceSelection: { modelId: 'qwen3', language: 'english' },
      recoverableStages: {
        cast: {
          attempt: 2,
          message: 'Completed work is saved. Continue this step to resume.',
          modelId: 'qwen-audio',
          language: 'english',
          proposalRevision: 'cast-proposal-1',
        },
      },
      recordingScript: undefined,
      generatedChapters: [],
    }

    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))

    expect(screen.getByLabelText('Voice model')).toHaveValue('qwen-audio')
    expect(screen.getByText('Completed voices are saved; continue from the interrupted voice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue voice generation →' })).toBeInTheDocument()
  })

  it('keeps a recoverable cast failure actionable instead of replacing it generically', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r1' },
      cast: {
        revision: 'cast-proposal-1', phase: 'identity-review', dossiers: [], proposals: [],
        detectedLanguage: 'english',
      },
      recordingScript: undefined,
      generatedChapters: [],
    }
    const publicError = (
      'Oops—voice generation paused at Alice. 12 of 61 completed voices are safely saved. '
      + 'Choose Continue voice generation below to resume from this voice.'
    )
    vi.mocked(wizardApi.processStage).mockResolvedValue({
      id: 'cast-job', status: 'failed', error: publicError,
    })

    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate required auditions →' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Voice generation paused at Alice. 12 of 61 voices are saved. Choose Continue voice generation to resume.')
    expect(screen.getByRole('button', { name: 'Continue voice generation →' })).toBeInTheDocument()
  })

  it('can cancel running full-cast voice generation', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r1' },
      cast: {
        revision: 'cast-proposal-1', phase: 'identity-review', dossiers: [], proposals: [],
        detectedLanguage: 'english',
      },
      recordingScript: undefined,
      generatedChapters: [],
    }
    let finishJob!: (job: Job) => void
    vi.mocked(wizardApi.processStage).mockResolvedValue({
      id: 'cast-job', kind: 'v2:cast', status: 'running', message: 'Generating voices',
    })
    vi.mocked(wizardApi.getJob).mockImplementation(() => new Promise((resolve) => { finishJob = resolve }))
    vi.mocked(wizardApi.cancelJob).mockResolvedValue({
      id: 'cast-job', kind: 'v2:cast', status: 'running',
      message: 'Cancellation requested; stopping after the active task',
      cancel_requested_at: '2026-07-20T10:00:00Z',
    })

    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate required auditions →' }))

    const dialog = await screen.findByRole('dialog', { name: 'Local processing' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel voice generation' }))
    await waitFor(() => expect(wizardApi.cancelJob).toHaveBeenCalledWith('cast-job'))
    expect(within(dialog).getByRole('button', { name: 'Canceling…' })).toBeDisabled()
    finishJob({ id: 'cast-job', kind: 'v2:cast', status: 'canceled' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Local processing' })).not.toBeInTheDocument())
  })

  it('prepares an editable accepted cast and opens voices after confirmation', async () => {
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'cast-job', status: 'succeeded', result: { revision: 'cast-replacement' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      ...base.cast!, revision: 'cast-replacement', phase: 'audition-review',
    })
    await open()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.getByText(/only the replacement can generate new audio/)).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Change settings →' })
    trigger.focus()
    fireEvent.click(trigger)
    const confirmation = screen.getByRole('dialog', { name: 'Change the cast?' })
    expect(confirmation).toHaveTextContent('previous voices can no longer generate new audio')
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    fireEvent.keyDown(confirmation, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Change settings →' })).toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Keep current cast' }))
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Change cast →' }))
    expect(await screen.findByRole('region', { name: 'Cast voice auditions' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review cast & voices →' })).not.toBeInTheDocument()
    expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'cast', {})
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'cast', 'cast-replacement')
    fireEvent.click(screen.getByRole('button', { name: '← Edit cast' }))
    expect(screen.getByRole('region', { name: 'Cast members' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel cast edits' }))
    expect(screen.getByRole('region', { name: 'Cast voice auditions' })).toBeInTheDocument()
  })

  it('keeps the accepted cast available when preparing its replacement fails', async () => {
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'cast-job', status: 'failed', error: 'Could not prepare cast' })
    await open()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change cast →' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
    expect(screen.getByRole('heading', { name: 'Cast and voices ready' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change settings →' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Cast voice auditions' })).not.toBeInTheDocument()
  })

  it('reuses previously accepted auditions after a Review-only change', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r2' },
      history: { cast: [{ revision: 'c1', status: 'superseded' }] },
      cast: undefined,
      recordingScript: undefined,
      generatedChapters: [],
    }
    const reusedCast = {
      revision: 'cast-rebased', phase: 'audition-review' as const, dossiers: [], proposals: [],
      narrator: {
        characterId: 'narrator', name: 'Narrator', voiceAccepted: true,
        acceptedVoiceRevision: 'nv1', voicePreviewRevision: 'nv1', previewUrl: '/n.wav',
        voiceCandidates: [{ revision: 'nv1', previewUrl: '/n.wav', referenceText: 'Narrator sample.' }],
      },
      identities: [],
      language: 'english', voiceModel: 'qwen',
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'cast-job', status: 'succeeded', result: { revision: 'cast-rebased' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue(reusedCast)

    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Review cast & voices →' }))

    expect(await screen.findByRole('region', { name: 'Cast voice auditions' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate required auditions →' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept cast & voices →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'cast', 'cast-rebased', [
      { characterId: 'narrator', voiceRevision: 'nv1' },
    ]))
    expect(screen.queryByText(/will use default audition/)).not.toBeInTheDocument()
  })

  it('restores a newer cast draft with its decisions and voice settings', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review', 'cast'] },
      pendingCandidates: { cast: { revision: 'cast-draft', status: 'candidate' } },
      generatedChapters: [],
    }
    const draft: CastArtifact = {
      revision: 'cast-draft', phase: 'audition-review', dossiers: [],
      proposals: [{ label: 'Alice', category: 'character', canonicalName: 'Alice', reviewRequired: true }],
      identityDecisions: [{ label: 'Alice', category: 'character', canonicalName: 'Alice', aliases: [], primaryLabel: 'Alice' }],
      narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv2', previewUrl: '/n2.wav', voiceAccepted: true, acceptedVoiceRevision: 'nv2' },
      identities: [{ characterId: 'alice', name: 'Alice', voicePreviewRevision: 'av2', previewUrl: '/a2.wav', voiceAccepted: true, acceptedVoiceRevision: 'av2' }],
      voiceModel: 'qwen', language: 'english',
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue(draft)

    await open(snapshot)
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    expect(within(nav).getByRole('button', { name: /Cast & voices Draft ready/ })).toBeInTheDocument()
    fireEvent.click(within(nav).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change cast →' }))

    expect(screen.getByRole('region', { name: 'Cast voice auditions' })).toBeInTheDocument()
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'cast', 'cast-draft')
    expect(screen.getByText('All 2 voices approved')).toBeInTheDocument()
  })

  it('reclassifies a reused cast only from its review view and preserves the accepted flow', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r2', cast: 'c1' },
      history: { cast: [{ revision: 'c1', status: 'superseded' }] },
      cast: undefined,
      recordingScript: undefined,
      generatedChapters: [],
    }
    const reusedCast = {
      revision: 'cast-rebased', phase: 'audition-review' as const, reusedFromRevision: 'c1',
      dossiers: [], proposals: [],
      narrator: {
        characterId: 'narrator', name: 'Narrator', voiceAccepted: true,
        acceptedVoiceRevision: 'nv1', voicePreviewRevision: 'nv1', previewUrl: '/n.wav',
        voiceCandidates: [{ revision: 'nv1', previewUrl: '/n.wav', referenceText: 'Narrator sample.' }],
      },
      identities: [], language: 'english', voiceModel: 'qwen',
    }
    const freshCast = {
      revision: 'cast-fresh', phase: 'identity-review' as const,
      dossiers: [], proposals: [], detectedLanguage: 'english',
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'cast-job', status: 'succeeded', result: { revision: 'cast-result' } })
    vi.mocked(wizardApi.getStageCandidate)
      .mockResolvedValueOnce(reusedCast)
      .mockResolvedValueOnce(freshCast)
    await open(snapshot)
    fireEvent.click(screen.getByRole('button', { name: 'Review cast & voices →' }))
    expect(await screen.findByRole('heading', { name: 'Voices' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reclassify from Dialogue' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← Review cast' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reclassify from Dialogue' }))
    const confirmation = screen.getByRole('dialog', { name: 'Reclassify source labels?' })
    expect(wizardApi.processStage).toHaveBeenCalledTimes(1)
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Reclassify labels →' }))

    await waitFor(() => expect(wizardApi.processStage).toHaveBeenLastCalledWith('book-1', 'cast', { forceReclassify: true }))
    expect(await screen.findByRole('region', { name: 'Cast members' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reclassify from Dialogue' })).not.toBeInTheDocument()
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()
  })

  it('lets the user approve detected chapter starts in one clear action', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
      boundaryCandidates: [{ id: 'b1', page: 2, source: 'Chapter 1', reason: 'Standalone heading' }],
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-2', warnings: [], boundaryCandidates: snapshot.boundaryCandidates })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(screen.getByRole('button', { name: 'Scan for issues →' }).closest('.stage-launch')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    expect(await screen.findByRole('navigation', { name: 'Review groups' })).toBeInTheDocument()
    expect(screen.getByRole('generic', { name: 'Chapter heading evidence' })).toHaveTextContent('Chapter 1')
    fireEvent.click(screen.getByRole('button', { name: /Start a new chapter/ }))
    expect(screen.getByRole('button', { name: /Start a new chapter/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Audio before this heading stays in the previous chapter.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeEnabled()
  })

  it('offers one explicit bulk decision for all detected chapter headings', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    const boundaryCandidates = [
      { id: 'b1', page: 2, source: 'Chapter 1', reason: 'Standalone heading' },
      { id: 'b2', page: 8, source: 'Chapter 2', reason: 'Standalone heading' },
      { id: 'b3', page: 15, source: 'Chapter 3', reason: 'Standalone heading' },
    ]
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-2', warnings: [], boundaryCandidates })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    expect(await screen.findByText('Same decision for every heading?')).toBeInTheDocument()
    const bulkDecision = screen.getByRole('button', { name: 'Mark all 3 as chapter starts' })
    expect(bulkDecision).toHaveClass('review-bulk-button')
    fireEvent.click(bulkDecision)

    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeEnabled()
    expect(screen.queryByText('Same decision for every heading?')).not.toBeInTheDocument()
  })

  it('keeps preserved bracketed prose outside the decision queue without blocking review', async () => {
    const snapshot: WizardSnapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] }, activeArtifacts: { extraction: 'e1', dialogue: 'd1' }, pendingCandidates: { review: { revision: 'review-preserved', status: 'candidate' } } }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-preserved', warnings: [], boundaryCandidates: [], scriptDirectionsSummary: { candidates: 30, proposals: 0, kept: 30 } })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(await screen.findByText('30 bracketed passages kept spoken. No individual decisions needed.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Script directions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeEnabled()
  })

  it('keeps script cue choices in the established order and preserves manual choices through bulk and acceptance', async () => {
    const snapshot: WizardSnapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] }, activeArtifacts: { extraction: 'e1', dialogue: 'd1' }, pendingCandidates: { review: { revision: 'review-cues', status: 'candidate' } } }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-cues', warnings: [scriptDirectionsWarning], boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(await screen.findByRole('heading', { name: 'Script directions' })).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: /^Apply suggested choices/ })
    expect([...apply.parentElement!.querySelectorAll('button')].map((button) => button.querySelector('b')?.textContent)).toEqual(['Keep', 'Leave', 'Apply suggested choices'])
    expect(screen.getByText('AI checked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /narrator|extraction again/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI suggestions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Keep This highlighted/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Leave This highlighted/ }))
    expect(screen.getByText('Example 3 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Apply suggested choices/ }))
    expect(screen.getByRole('button', { name: /^Apply suggested choices/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '← Previous example' }))
    expect(screen.getByRole('button', { name: /^Leave This highlighted/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '← Previous example' }))
    expect(screen.getByRole('button', { name: /^Keep This highlighted/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Review complete transcript →' }))
    await screen.findByRole('article', { name: 'Audiobook transcript page 1' })
    expect(wizardApi.previewReviewTranscript).toHaveBeenLastCalledWith('book-1', 'review-cues', 1, [], [
      { occurrenceId: 'cue-soft', action: 'keep' }, { occurrenceId: 'cue-creepy', action: 'exclude' }, { occurrenceId: 'cue-loud', action: 'exclude' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Accept review and continue →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'review', 'review-cues', [
      { occurrenceIds: ['cue-soft'], action: 'keep', provenance: 'user' }, { occurrenceIds: ['cue-creepy'], action: 'exclude', provenance: 'user' }, { occurrenceIds: ['cue-loud'], action: 'exclude', provenance: 'user' },
    ]))
  })

  it('restores AI suggestions as a category with Keep, Leave and persistent bulk options', async () => {
    const snapshot: WizardSnapshot = {
      ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' }, pendingCandidates: { review: { revision: 'review-ai', status: 'candidate' } },
    }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-ai', warnings: [cleanupWarning], boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(await screen.findByText('broken')).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: /^Apply all AI suggestions/ })
    expect(apply.closest('.resolution-panel')).not.toBeNull()
    expect(apply).toHaveClass('cleanup-bulk-warning')
    expect(screen.getByRole('heading', { name: 'AI suggestions' }).closest('.review-group-heading')).not.toHaveTextContent('warning')
    expect(screen.getByRole('complementary', { name: 'Decision queue' })).not.toHaveTextContent('warning')
    expect(within(screen.getByRole('complementary', { name: 'Decision queue' })).queryByRole('button', { name: /^Apply all/ })).not.toBeInTheDocument()
    expect([...apply.parentElement!.querySelectorAll('button')].map((button) => button.querySelector('b')?.textContent)).toEqual(['Keep', 'Leave', 'Apply all AI suggestions'])
    expect(screen.queryByRole('button', { name: /Try extraction again/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Keep Keep the original/ }))
    expect(screen.getByText('Remove the flagged text from the audiobook transcript.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Apply all AI suggestions/ })).toHaveTextContent('Apply 1 undecided AI suggestion.')
    fireEvent.click(screen.getByRole('button', { name: /^Apply all AI suggestions/ }))
    expect(screen.getByRole('button', { name: /^Apply all AI suggestions/ })).toBeDisabled()
    expect(screen.getByText('No correction was proposed. Check the source before keeping or leaving out this text.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Keep Keep the original/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review complete transcript →' }))
    await screen.findByRole('article', { name: 'Audiobook transcript page 1' })
    expect(wizardApi.previewReviewTranscript).toHaveBeenLastCalledWith('book-1', 'review-ai', 1, [], [
      { occurrenceId: 'join', action: 'keep' }, { occurrenceId: 'delete', action: 'repair' }, { occurrenceId: 'missing', action: 'keep' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Accept review and continue →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'review', 'review-ai', [
      { occurrenceIds: ['join'], action: 'keep', provenance: 'user' }, { occurrenceIds: ['delete'], action: 'repair', provenance: 'user' }, { occurrenceIds: ['missing'], action: 'keep', provenance: 'user' },
    ]))
  })

  it('moves saved overlapping corrections into AI suggestions without duplicating source-only warnings', async () => {
    const snapshot: WizardSnapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] }, activeArtifacts: { extraction: 'e1', dialogue: 'd1' }, pendingCandidates: { review: { revision: 'review-consolidated', status: 'candidate' } } }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-consolidated', warnings: [consolidatedCleanupWarning], boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(await screen.findByText('A strange fragment.')).toBeInTheDocument()
    expect(screen.queryByText('broken')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try extraction again/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Leave out/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Keep Keep the original/ }))
    fireEvent.click(screen.getByRole('button', { name: /AI suggestions.*2 occurrences/ }))
    expect(screen.getByText('broken')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Apply all AI suggestions/ }))
    expect(screen.getByText('AI correction selected for this example. It will apply when you accept the review.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review complete transcript →' }))
    await screen.findByRole('article', { name: 'Audiobook transcript page 1' })
    expect(wizardApi.previewReviewTranscript).toHaveBeenLastCalledWith('book-1', 'review-consolidated', 1, [], [
      { occurrenceId: 'ordinary', action: 'exclude' }, { occurrenceId: 'missing', action: 'keep' }, { occurrenceId: 'join', action: 'repair' }, { occurrenceId: 'delete', action: 'repair' },
    ])
  })

  it('keeps 150 AI suggestions bounded to one example and allows overrides after bulk applying', async () => {
    const many = { ...cleanupWarning, occurrences: Array.from({ length: 150 }, (_, i) => ({ ...cleanupWarning.occurrences[0], id: `ai-${i}`, source: `Source fragment ${i}`, replacement: `Corrected fragment ${i}` })) }
    const snapshot: WizardSnapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] }, activeArtifacts: { extraction: 'e1', dialogue: 'd1' }, pendingCandidates: { review: { revision: 'review-many', status: 'candidate' } } }
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-many', warnings: [many], boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    expect(await screen.findByText('Example 1 of 150')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Proposed correction')).toHaveLength(1)
    expect(screen.queryByText('Corrected fragment 149')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Keep Keep the original/ }))
    expect(screen.getByText('Example 2 of 150')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Leave This highlighted/ }))
    expect(screen.getByText('Example 3 of 150')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Apply all AI suggestions/ })).toHaveTextContent('Apply 148 undecided AI suggestions.')
    fireEvent.click(screen.getByRole('button', { name: /^Apply all AI suggestions/ }))
    expect(screen.getByRole('button', { name: /^Apply all AI suggestions/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review complete transcript →' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Keep Keep the original/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Apply all AI suggestions/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next example →' }))
    expect(screen.getByRole('button', { name: /^Leave This highlighted/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Next example →' }))
    expect(screen.getByText('AI correction selected for this example. It will apply when you accept the review.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Keep Keep the original/ }))
    expect(screen.getByRole('button', { name: /^Apply all AI suggestions/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Apply all AI suggestions/ })).toHaveTextContent('No undecided AI suggestions.')
    fireEvent.click(screen.getByRole('button', { name: /^Apply all AI suggestions/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review complete transcript →' }))
    await screen.findByRole('article', { name: 'Audiobook transcript page 1' })
    const policies = vi.mocked(wizardApi.previewReviewTranscript).mock.lastCall![4]
    expect(policies).toHaveLength(150)
    expect(policies?.slice(0, 3)).toEqual([{ occurrenceId: 'ai-0', action: 'keep' }, { occurrenceId: 'ai-1', action: 'exclude' }, { occurrenceId: 'ai-2', action: 'keep' }])
  })

  it('shows the complete read-only transcript beside the synchronized PDF page', async () => {
    vi.mocked(wizardApi.previewReviewTranscript).mockResolvedValue({
      page: 1,
      pageCount: 120,
      imageUrl: '/page-1.png',
      published: false,
      summary: { spoken: 3, dialogue: 2, excluded: 0 },
      spans: [
        { id: 'n-1', kind: 'narration', reader: 'Narrator', text: 'Alice was beginning to get very tired.', blockId: 'p1', sourceStart: 0, sourceEnd: 39 },
        { id: 'd-1', kind: 'dialogue', reader: 'Alice', text: 'What is the use of a book?', blockId: 'p1', sourceStart: 40, sourceEnd: 70 },
        { id: 'u-1', kind: 'dialogue', reader: 'Narrator', text: 'An unresolved line.', blockId: 'p1', sourceStart: 71, sourceEnd: 90 },
      ],
    })
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-2', warnings: [], boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))
    await screen.findByText('Nothing needs review')

    fireEvent.click(screen.getByRole('button', { name: 'Review complete transcript →' }))

    const transcript = await screen.findByRole('article', { name: 'Audiobook transcript page 1' })
    expect(transcript).toHaveTextContent('NarratorAlice was beginning to get very tired.')
    expect(within(transcript).getByText('An unresolved line.').closest('p')).toHaveClass('narration')
    expect(within(transcript).getByText('An unresolved line.').closest('p')).not.toHaveClass('dialogue')
    expect(fireEvent.copy(transcript)).toBe(false)
    expect(transcript.closest('.review-transcript-pane')).toHaveClass('review-transcript-pane')
    expect(screen.getByAltText('Original PDF page 1')).toHaveAttribute('src', '/page-1.png')
    expect(screen.getByText('ORIGINAL PAGE').closest('.compare')).toHaveClass('page-comparison')
    const pdfPreview = screen.getByAltText('Original PDF page 1')
    const zoomOut = screen.getByRole('button', { name: 'Zoom out PDF preview' })
    const zoomIn = screen.getByRole('button', { name: 'Zoom in PDF preview' })
    expect(pdfPreview).toHaveStyle({ width: '100%' })
    fireEvent.click(zoomIn)
    expect(pdfPreview).toHaveStyle({ width: '125%' })
    fireEvent.click(zoomIn)
    expect(pdfPreview).toHaveStyle({ width: '150%' })
    expect(zoomIn).toBeDisabled()
    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    expect(pdfPreview).toHaveStyle({ width: '60%' })
    expect(zoomOut).toBeDisabled()
    expect(screen.queryByText('Synchronized page browser')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready to inspect')).not.toBeInTheDocument()
    expect(screen.queryByText('Tip: drag the slider for a fast visual sweep, then use the arrows for close reading.')).not.toBeInTheDocument()
    expect(wizardApi.previewReviewTranscript).toHaveBeenCalledWith('book-1', 'review-2', 1, [])

    let finishPageNine!: (value: Awaited<ReturnType<typeof wizardApi.previewReviewTranscript>>) => void
    vi.mocked(wizardApi.previewReviewTranscript).mockImplementationOnce(() => new Promise((resolve) => { finishPageNine = resolve }))
    fireEvent.change(screen.getByRole('slider', { name: 'Transcript preview page' }), { target: { value: '9' } })
    await waitFor(() => expect(wizardApi.previewReviewTranscript).toHaveBeenLastCalledWith('book-1', 'review-2', 9, []))
    expect(screen.getByAltText('Original PDF page 1')).toHaveAttribute('src', '/page-1.png')
    expect(screen.getByText('ORIGINAL PAGE').closest('.compare')).toHaveClass('loading')
    expect(screen.getByRole('article', { name: 'Audiobook transcript page 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept review and continue →' })).toBeDisabled()
    finishPageNine({ page: 9, pageCount: 120, imageUrl: '/page-9.png', published: false, summary: { spoken: 1, dialogue: 0, excluded: 0 }, spans: [{ id: 'n-9', kind: 'narration', reader: 'Narrator', text: 'Page nine.', blockId: 'p9', sourceStart: 0, sourceEnd: 10 }] })
    expect(await screen.findByRole('article', { name: 'Audiobook transcript page 9' })).toBeInTheDocument()
    expect(screen.getByAltText('Original PDF page 9')).toHaveAttribute('src', '/page-9.png')

    fireEvent.click(screen.getByRole('button', { name: '← Back to decisions' }))
    expect(screen.getByText('Nothing needs review')).toBeInTheDocument()
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()
  })

  it('scrolls the next review group into view during automatic progression', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    const warnings = Array.from({ length: 4 }, (_, index) => ({
      id: `matter-${index}`,
      kind: 'repeated-matter',
      severity: 'warning',
      detail: `Repeated edge text ${index + 1}`,
      availableActions: ['keep', 'exclude'],
      occurrences: [{ id: `o${index}`, page: index + 2, source: `HEADER ${index + 1}` }],
    }))
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-2', warnings, boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    await screen.findByRole('navigation', { name: 'Review groups' })
    fireEvent.click(screen.getByRole('button', { name: /Keep as is/ }))

    expect(document.querySelector('[data-review-group="warning-1"]')).toHaveClass('active')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView })
  })

  it('reviews chapter boundaries and source warnings through a semantic queue and focused evidence workspace', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'review-2',
      boundaryCandidates: [{ id: 'b1', page: 2, source: 'Chapter 1', reason: 'Standalone heading', contextBefore: 'The last visitor left.', contextAfter: 'Morning came at last.' }],
      warnings: [{
        id: 'matter', kind: 'repeated-matter', severity: 'warning', detail: 'Repeated edge text',
        availableActions: ['keep', 'exclude'], occurrences: [{ id: 'o1', page: 4, source: 'ALICE' }],
      }],
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    const groups = await screen.findByRole('navigation', { name: 'Review groups' })
    expect(within(groups).getByRole('button', { name: /Chapter starts/ })).toBeInTheDocument()
    expect(within(groups).getByRole('button', { name: /Repeated page matter/ })).toBeInTheDocument()
    expect(groups.closest('.review-queue')).toBeInTheDocument()
    expect(screen.getByText('Decision queue')).toBeInTheDocument()

    expect(screen.getByText('The last visitor left.')).toBeInTheDocument()
    expect(screen.getByText('Morning came at last.')).toBeInTheDocument()
    const workspace = document.querySelector('.review-workspace')
    fireEvent.click(within(groups).getByRole('button', { name: /Repeated page matter/ }))
    expect(await screen.findByText('ALICE')).toBeInTheDocument()
    expect(document.querySelector('.review-workspace')).toBe(workspace)
  })

  it('keeps the Review issue scan in place without a processing overlay', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    let finishScan!: (job: { id: string; status: 'succeeded'; result: { revision: string } }) => void
    vi.mocked(wizardApi.processStage).mockReturnValue(new Promise((resolve) => { finishScan = resolve }))
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-2', warnings: [], boundaryCandidates: [] })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))

    const scanButton = screen.getByRole('button', { name: 'Scan for issues →' })
    fireEvent.click(scanButton)

    expect(screen.queryByRole('button', { name: 'Scan for issues →' })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Scanning for issues…' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Local processing' })).not.toBeInTheDocument()
    finishScan({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    expect(await screen.findByRole('heading', { name: 'Nothing needs review' })).toBeInTheDocument()
  })

  it('starts a fresh Review candidate from Change settings and keeps the accepted review until approval', async () => {
    let finishScan!: (job: { id: string; status: 'succeeded'; result: { revision: string } }) => void
    vi.mocked(wizardApi.processStage).mockReturnValue(new Promise((resolve) => { finishScan = resolve }))
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-replacement', warnings: [], boundaryCandidates: [] })
    await open()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))

    expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'review', {})
    expect(screen.getByRole('status', { name: 'Scanning for issues…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scan for issues →' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Local processing' })).not.toBeInTheDocument()
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()

    finishScan({ id: 'review-job', status: 'succeeded', result: { revision: 'review-replacement' } })
    expect(await screen.findByRole('heading', { name: 'Nothing needs review' })).toBeInTheDocument()
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'review', 'review-replacement')
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()
  })

  it('lets a failed automatic Review scan retry in place', async () => {
    vi.mocked(wizardApi.processStage)
      .mockRejectedValueOnce(new Error('Review scan unavailable'))
      .mockResolvedValueOnce({ id: 'review-job', status: 'succeeded', result: { revision: 'review-retry' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-retry', warnings: [], boundaryCandidates: [] })
    await open()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))
    expect(await screen.findByRole('heading', { name: 'Nothing needs review' })).toBeInTheDocument()
    expect(wizardApi.processStage).toHaveBeenCalledTimes(2)
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()
  })

  it('shows one bounded context excerpt and explains retention separately from narrator assignment', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'review-2', boundaryCandidates: [], warnings: [{
        id: 'artifact', kind: 'extraction-artifact', severity: 'warning', detail: 'Generic detector copy',
        readerState: 'assigned-speaker', availableActions: ['narrate', 'exclude', 'keep'],
        occurrences: [{ id: 'o1', page: 4, source: 'CHAPTER DECORATION', contextBefore: 'Alice opened the door.', contextAfter: 'She stepped inside.' }],
      }],
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    const excerpt = await screen.findByRole('generic', { name: 'Manuscript context' })
    expect(within(excerpt).getByText('Text immediately before')).toBeInTheDocument()
    expect(within(excerpt).getByText('CHAPTER DECORATION')).toBeInTheDocument()
    expect(within(excerpt).getByText('Text immediately after')).toBeInTheDocument()
    expect(screen.queryByText('SOURCE EVIDENCE')).not.toBeInTheDocument()
    expect(screen.queryByText('PROPOSED OUTCOME')).not.toBeInTheDocument()
    expect(screen.getByText('Does this text match the source?')).toBeInTheDocument()

    const choices = screen.getAllByRole('button').filter((button) => ['Keep as is', 'Leave out', 'Use narrator instead'].includes(button.querySelector('b')?.textContent ?? ''))
    expect(choices.map((button) => button.querySelector('b')?.textContent)).toEqual([
      'Keep as is', 'Leave out', 'Use narrator instead',
    ])
    fireEvent.click(screen.getByRole('button', { name: /Keep as is/ }))
    expect(screen.getAllByText(/keep its current reader/)).toHaveLength(1)
  })

  it('does not offer a narrator override when the narrator already reads the text', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'review-2', boundaryCandidates: [], warnings: [{
        id: 'matter', kind: 'peripheral-matter', severity: 'warning', detail: 'Front matter',
        readerState: 'narrator', availableActions: ['keep', 'exclude'],
        occurrences: [{ id: 'o1', page: 1, source: 'Copyright 1865' }],
      }],
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    expect(await screen.findByRole('button', { name: /Keep with narrator/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Leave out/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Use narrator instead/ })).not.toBeInTheDocument()
    expect(screen.getByText('This highlighted text will be read by the narrator.')).toBeInTheDocument()
  })

  it('routes a source-coverage invariant failure to recovery instead of a warning decision', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'review-2', warnings: [], boundaryCandidates: [],
      recovery: {
        kind: 'source-coverage',
        message: 'Extraction completed, but Dialogue no longer partitions its source exactly.',
        availableActions: ['rerun-dialogue', 'rerun-extraction'],
      },
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    expect(await screen.findByRole('heading', { name: 'The transcript needs rebuilding before review.' })).toBeInTheDocument()
    expect(screen.getByText(/transcript needs to be rebuilt to match/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rebuild Dialogue/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try another extraction/ })).not.toBeInTheDocument()
    expect(screen.queryByText('malformed coverage')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review complete transcript →' })).not.toBeInTheDocument()
  })

  it('keeps the Review workspace mounted and advances to the next unresolved issue', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
    }
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({
      revision: 'review-2', boundaryCandidates: [], warnings: [
        {
          id: 'artifact', kind: 'extraction-artifact', severity: 'warning', detail: 'Possible ornament',
          availableActions: ['keep', 'exclude'], occurrences: [{ id: 'o1', page: 4, source: 'ORNAMENT' }],
        },
        {
          id: 'layout', kind: 'layout-order', severity: 'warning', detail: 'Possible column order issue',
          availableActions: ['keep', 'rerun-extraction'], occurrences: [{ id: 'o2', page: 5, source: 'NEXT ISSUE' }],
        },
      ],
    })
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))

    await screen.findByText('ORNAMENT')
    const workspace = document.querySelector('.review-workspace')
    fireEvent.click(screen.getByRole('button', { name: /Keep as is/ }))

    expect(screen.getByText('NEXT ISSUE')).toBeInTheDocument()
    expect(document.querySelector('.review-workspace')).toBe(workspace)
  })

  it('shows progress while applying Review and advances to Cast after acceptance', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1' },
      boundaryCandidates: [{ id: 'b1', page: 2, source: 'Chapter 1', reason: 'Standalone heading' }],
    }
    const accepted: WizardSnapshot = {
      ...snapshot,
      book: { ...snapshot.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { ...snapshot.activeArtifacts, review: 'r1' },
    }
    let finishAccept!: () => void
    vi.mocked(wizardApi.acceptStage).mockImplementation(() => new Promise<void>((resolve) => { finishAccept = resolve }))
    vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'review-job', status: 'succeeded', result: { revision: 'review-2' } })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-2', warnings: [], boundaryCandidates: snapshot.boundaryCandidates })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(accepted)
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Review'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for issues →' }))
    await screen.findByRole('generic', { name: 'Chapter heading evidence' })
    fireEvent.click(screen.getByRole('button', { name: /Start a new chapter/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review complete transcript →' }))
    expect(await screen.findByRole('heading', { name: 'Read it once like a listener.' })).toBeInTheDocument()
    const acceptReview = screen.getByRole('button', { name: 'Accept review and continue →' })
    await waitFor(() => expect(acceptReview).toBeEnabled())
    fireEvent.click(acceptReview)

    const processingDialog = await screen.findByRole('dialog', { name: 'Local processing' })
    expect(processingDialog).toHaveTextContent('Applying review decisions')
    const progressbar = within(processingDialog).getByRole('progressbar', { name: 'Processing progress' })
    expect(progressbar).toHaveClass('active')
    expect(progressbar.style.getPropertyValue('--progress')).toBe(`${progressbar.getAttribute('aria-valuenow')}%`)
    finishAccept()

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Local processing' })).not.toBeInTheDocument())
    expect(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByRole('button', { name: /Cast & voices In progress/ })).toHaveClass('active')
  })

  it('does not mark a completed stage as a draft when the user only opens its settings', async () => {
    await open()
    const nav = screen.getByRole('navigation', { name: 'Wizard stages' })
    fireEvent.click(within(nav).getByText('Extract'))
    fireEvent.click(screen.getByRole('button', { name: 'Change settings →' }))
    const extract = within(nav).getByRole('button', { name: /Extract Complete/ })
    expect(extract).not.toHaveClass('revising')
  })

  it('does not block auditions for an informational single-character suggestion', async () => {
    const snapshot = { ...base, book: { ...base.book, completedStages: ['import','extract','dialogue','review'] as WizardStage[] }, cast: { revision: 'cp', phase: 'identity-review' as const, dossiers: [{ label: 'Alice?', occurrenceCount: 4, examples: [{ source: 'Alice? [Wait.]' }] }], proposals: [{ label: 'Alice?', category: 'character', canonicalName: 'Alice', reviewRequired: true }] }, generatedChapters: [] }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.getByRole('button', { name: 'Generate required auditions →' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Alice' }))
    const identityDialog = screen.getByRole('dialog', { name: 'Inspect Alice' })
    expect(identityDialog).toHaveTextContent('Review suggested')
    expect(identityDialog).toHaveTextContent('Optional check')
    expect(within(identityDialog).queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()
    expect(screen.getByText('Cast structure is ready')).toBeInTheDocument()
  })

  it('blocks auditions until an AI-created multi-label identity is confirmed', async () => {
    const snapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] as WizardStage[] },
      cast: {
        revision: 'cp', phase: 'identity-review' as const,
        dossiers: [
          { label: 'Alice', occurrenceCount: 4, examples: [{ source: 'Alice: Wait.' }] },
          { label: 'Alice Liddell', occurrenceCount: 2, examples: [{ source: 'Alice Liddell: Look.' }] },
        ],
        proposals: [
          { label: 'Alice', category: 'character', canonicalName: 'Alice', aliases: ['Alice Liddell'], reviewRequired: true },
          { label: 'Alice Liddell', category: 'character', canonicalName: 'Alice', aliases: ['Alice'], reviewRequired: true },
        ],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.getByRole('button', { name: 'Confirm cast identities →' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Alice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm grouping' }))
    expect(screen.getByRole('button', { name: 'Generate required auditions →' })).toBeEnabled()
  })

  it('keeps exact per-voice approvals and cast editing available', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] },
      cast: {
        revision: 'auditions-1', phase: 'audition-review', dossiers: [],
        proposals: [{ label: 'Alice', category: 'character', canonicalName: 'Alice', reviewRequired: true }],
        identityDecisions: [{ label: 'Alice', category: 'character', canonicalName: 'Alice', aliases: [], primaryLabel: 'Alice' }],
        narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv1', previewUrl: '/n.wav' },
        identities: [{ characterId: 'alice', name: 'Alice', voicePreviewRevision: 'av1', previewUrl: '/a.wav' }],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.getByRole('button', { name: 'Accept cast & voices →' })).toBeEnabled()
    expect(screen.getByRole('region', { name: 'Cast voice auditions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Narrator voice' })).not.toHaveAttribute('draggable')
    fireEvent.click(screen.getByRole('button', { name: 'Open Narrator voice' }))
    const narratorDialog = screen.getByRole('dialog', { name: 'Narrator voice' })
    expect(within(narratorDialog).getByRole('button', { name: 'Create a new audition' })).toBeInTheDocument()
    expect(narratorDialog).not.toHaveTextContent('Tune and generate')
    fireEvent.click(within(narratorDialog).getByRole('button', { name: 'Apply Audition 1' }))
    fireEvent.click(within(narratorDialog).getByRole('button', { name: 'Close voice' }))
    fireEvent.animationEnd(narratorDialog)
    fireEvent.click(screen.getByRole('button', { name: 'Open Alice voice' }))
    const aliceDialog = screen.getByRole('dialog', { name: 'Alice voice' })
    fireEvent.click(within(aliceDialog).getByRole('button', { name: 'Apply Audition 1' }))
    fireEvent.click(within(aliceDialog).getByRole('button', { name: 'Close voice' }))
    fireEvent.animationEnd(aliceDialog)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept cast & voices →' })).toBeEnabled())
    const voiceActions = screen.getByRole('group', { name: 'Cast voice actions' })
    expect(within(voiceActions).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '← Edit cast',
      'Accept cast & voices →',
    ])
    fireEvent.click(within(voiceActions).getByRole('button', { name: '← Edit cast' }))
    const editActions = screen.getByRole('group', { name: 'Cast edit actions' })
    expect(within(editActions).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Cancel cast edits',
      'Apply cast edits →',
    ])
    const applyEdits = within(editActions).getByRole('button', { name: 'Apply cast edits →' })
    expect(applyEdits).toBeDisabled()
    expect(screen.getByText('No cast changes to apply')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Alice' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New cast member name' }), { target: { value: 'Alice Liddell' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(applyEdits).toBeEnabled()
  })

  it('starts a new audition directly without a replacement warning', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      cast: {
        revision: 'auditions-ghost', phase: 'audition-review', dossiers: [], proposals: [],
        narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv1', previewUrl: '/n.wav' },
        identities: [],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Narrator voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create a new audition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate new audition →' }))
    expect(screen.queryByRole('dialog', { name: 'Create a replacement audition?' })).not.toBeInTheDocument()
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'cast', expect.objectContaining({
      proposalRevision: 'auditions-ghost', characterId: 'narrator', voiceSettings: expect.objectContaining({ tone: 'warm' }),
    })))
  })

  it('creates a first audition directly without warning about replacing nonexistent auditions', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      cast: {
        revision: 'first-audition', phase: 'audition-review', dossiers: [], proposals: [],
        narrator: { characterId: 'narrator', name: 'Narrator' }, identities: [],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Narrator voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create a new audition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate new audition →' }))
    expect(screen.queryByRole('dialog', { name: 'Create a replacement audition?' })).not.toBeInTheDocument()
    await waitFor(() => expect(wizardApi.processStage).toHaveBeenCalledWith('book-1', 'cast', expect.objectContaining({
      proposalRevision: 'first-audition', characterId: 'narrator', voiceSettings: expect.objectContaining({ tone: 'warm' }),
    })))
  })

  it('offers one complete pack refresh when the registered voice recipe changed', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] },
      cast: {
        revision: 'auditions-old',
        phase: 'audition-review',
        auditionPackRecipeVersion: '6',
        auditionPackRefreshRequired: true,
        dossiers: [],
        proposals: [{ label: 'Alice', category: 'character', canonicalName: 'Alice', reviewRequired: false }],
        identityDecisions: [{ label: 'Alice', category: 'character', canonicalName: 'Alice', aliases: [], primaryLabel: 'Alice' }],
        narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv6', previewUrl: '/n.wav' },
        identities: [{ characterId: 'alice', name: 'Alice', voicePreviewRevision: 'av6', previewUrl: '/a.wav' }],
      },
      generatedChapters: [],
    }

    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))

    expect(screen.getByText('Your voices need refreshing before you continue.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh auditions →' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Accept cast & voices →' })).not.toBeInTheDocument()
  })

  it('warns before defaulting only unapproved voices and preserves an approved earlier revision', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] },
      cast: {
        revision: 'auditions-2', phase: 'audition-review', dossiers: [], proposals: [],
        narrator: {
          characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv2', previewUrl: '/n2.wav', referenceText: 'Newest narrator.',
          voiceCandidates: [
            { revision: 'nv1', previewUrl: '/n1.wav', referenceText: 'Earlier narrator.', direction: 'Warm.' },
            { revision: 'nv2', previewUrl: '/n2.wav', referenceText: 'Newest narrator.', direction: 'Crisp.' },
          ],
        },
        identities: [{
          characterId: 'alice', name: 'Alice', voicePreviewRevision: 'av2', previewUrl: '/a2.wav', referenceText: 'Newest Alice.',
          voiceCandidates: [
            { revision: 'av1', previewUrl: '/a1.wav', referenceText: 'Earlier Alice.', direction: 'Gentle.' },
            { revision: 'av2', previewUrl: '/a2.wav', referenceText: 'Newest Alice.', direction: 'Bright.' },
          ],
        }],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))

    fireEvent.click(screen.getByRole('button', { name: 'Open Narrator voice' }))
    const narratorDialog = screen.getByRole('dialog', { name: 'Narrator voice' })
    fireEvent.click(within(narratorDialog).getByRole('button', { name: 'Apply Audition 1' }))
    fireEvent.click(within(narratorDialog).getByRole('button', { name: 'Close voice' }))
    fireEvent.animationEnd(narratorDialog)

    fireEvent.click(screen.getByRole('button', { name: 'Accept cast & voices →' }))
    const warning = screen.getByRole('dialog', { name: 'Approve 1 remaining voice?' })
    expect(warning).toHaveTextContent('Continuing approves the default audition for Alice and accepts the full cast.')
    expect(warning).toHaveTextContent('Your 1 approved choice stays exactly as selected.')
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()

    fireEvent.click(within(warning).getByRole('button', { name: 'Approve remaining & accept →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'cast', 'auditions-2', [
      { characterId: 'narrator', voiceRevision: 'nv1' },
      { characterId: 'alice', voiceRevision: 'av1' },
    ]))
  })

  it('generates an audition line from a sample and its matching transcript', async () => {
    const cast: CastArtifact = {
      revision: 'auditions-upload-1', phase: 'audition-review', dossiers: [], proposals: [],
      narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv1', previewUrl: '/n.wav' },
      identities: [{
        characterId: 'alice', name: 'Alice', voicePreviewRevision: 'av1', previewUrl: '/a1.wav',
        referenceText: 'This is Alice.',
        voiceCandidates: [{ revision: 'av1', previewUrl: '/a1.wav', referenceText: 'This is Alice.', direction: 'Bright.' }],
      }],
    }
    const uploaded: CastArtifact = {
      ...cast,
      revision: 'auditions-upload-2',
      identities: [{
        ...cast.identities![0],
        voicePreviewRevision: 'upload-1', previewUrl: '/upload.wav',
        voiceCandidates: [
          ...cast.identities![0].voiceCandidates!,
          { revision: 'upload-1', previewUrl: '/upload.wav', previewText: 'This is Alice.', referenceText: 'These are the exact sample words.', referenceAudio: 'voices/alice/upload-1.reference.wav', direction: 'Cloned from uploaded voice sample', source: 'upload', referenceMode: 'transcript-conditioned', durationSeconds: 4 },
        ],
      }],
    }
    let finishUpload!: (value: CastArtifact) => void
    vi.mocked(wizardApi.uploadVoiceSample).mockReturnValue(new Promise((resolve) => { finishUpload = resolve }))
    await open({
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] },
      cast,
      generatedChapters: [],
    })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Alice voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create a new audition' }))
    fireEvent.click(screen.getByRole('radio', { name: /Clone from a sample/ }))
    const sample = new File(['voice'], 'alice.wav', { type: 'audio/wav' })
    fireEvent.change(screen.getByLabelText('Choose voice sample'), { target: { files: [sample] } })
    expect(screen.getByLabelText('Selected voice sample preview')).toHaveAttribute('src', 'blob:local-preview')
    await waitFor(() => expect(wizardApi.transcribeVoiceSample).toHaveBeenCalledWith('book-1', sample))
    await waitFor(() => expect(screen.getByLabelText('Voice sample transcript')).toHaveValue('Automatic draft.'))
    fireEvent.change(screen.getByLabelText('Voice sample transcript'), { target: { value: 'These are the exact sample words.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sampled audition →' }))

    await waitFor(() => expect(wizardApi.uploadVoiceSample).toHaveBeenCalledWith(
      'book-1', 'auditions-upload-1', 'alice', sample, 'These are the exact sample words.',
    ))
    expect(screen.getByRole('dialog', { name: 'Creating cloned audition…' })).toHaveTextContent(
      'Creating a voice audition from your sample',
    )
    finishUpload(uploaded)
    expect(await screen.findByText('Audition 2')).toBeInTheDocument()
    expect(screen.getByText('Cloned from a 4.0 sec sample')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Audition 2' })).toBeInTheDocument()
      expect(screen.getByText('Audition 2').closest('article')).toHaveClass('sample-derived')
    })

    expect(screen.queryByRole('button', { name: /Delete Audition/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply Audition 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply Audition 2' }))
    expect(screen.getByRole('button', { name: 'Apply Audition 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(wizardApi.deleteVoiceAudition).not.toHaveBeenCalled()

  })

  it('accepts a confirmed layered group route instead of a disposable group audition', async () => {
    const acceptedVoice = (characterId: string, name: string, revision: string) => ({
      characterId, name, category: 'character', literalLabels: [name],
      voicePreviewRevision: revision, acceptedVoiceRevision: revision, voiceAccepted: true,
      previewUrl: `/${revision}.wav`, referenceText: `${name} preview.`,
    })
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] },
      cast: {
        revision: 'auditions-layered', phase: 'audition-review', dossiers: [], proposals: [],
        narrator: { ...acceptedVoice('narrator', 'Narrator', 'nv1'), category: 'narrator' },
        identities: [
          acceptedVoice('subaru', 'Subaru', 'sv1'),
          acceptedVoice('cecilus', 'Cecilus', 'cv1'),
          { characterId: 'subaru-cecilus', name: 'Subaru & Cecilus', category: 'group', literalLabels: ['Subaru & Cecilus'], voicePreviewRevision: 'gv1', previewUrl: '/gv1.wav', referenceText: 'Group preview.' },
        ],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    expect(screen.getByRole('button', { name: 'Accept cast & voices →' })).toBeDisabled()
    const groupVoice = screen.getByRole('button', { name: 'Open Subaru & Cecilus voice' })
    expect(groupVoice).toHaveClass('voice-required', 'needs-review')
    expect(groupVoice).toHaveAttribute('aria-description', 'Required: confirm suggested voices')
    expect(screen.getByText('1 voice still requires review')).toBeInTheDocument()
    fireEvent.click(groupVoice)
    expect(screen.getByRole('radio', { name: /Layer existing cast voices/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm layered voices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept cast & voices →' }))

    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'cast', 'auditions-layered', [
      { characterId: 'narrator', voiceRevision: 'nv1' },
      { characterId: 'subaru', voiceRevision: 'sv1' },
      { characterId: 'cecilus', voiceRevision: 'cv1' },
      { characterId: 'subaru-cecilus', voiceRoute: { kind: 'layered', characterIds: ['subaru', 'cecilus'] } },
    ]))
    expect(screen.queryByText(/will use default audition/)).not.toBeInTheDocument()
  })

  it('opens Generate directly after approving the cast and preparing its recording script', async () => {
    vi.mocked(wizardApi.acceptStage).mockResolvedValue(undefined)
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import','extract','dialogue','review'] },
      cast: {
        revision: 'auditions-3', phase: 'audition-review', dossiers: [], proposals: [],
        narrator: { characterId: 'narrator', name: 'Narrator', voicePreviewRevision: 'nv1', previewUrl: '/n.wav' },
        identities: [],
      },
      generatedChapters: [],
    }
    await open(snapshot)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wizard stages' })).getByText('Cast & voices'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Narrator voice' }))
    const narratorDialog = screen.getByRole('dialog', { name: 'Narrator voice' })
    fireEvent.click(within(narratorDialog).getByRole('button', { name: 'Apply Audition 1' }))
    fireEvent.click(within(narratorDialog).getByRole('button', { name: 'Close voice' }))
    fireEvent.animationEnd(narratorDialog)

    vi.mocked(wizardApi.getBookSnapshot)
      .mockResolvedValueOnce({ ...base, recordingScript: undefined })
      .mockResolvedValue(base)
    fireEvent.click(screen.getByRole('button', { name: 'Accept cast & voices →' }))
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'cast', 'auditions-3', [
      { characterId: 'narrator', voiceRevision: 'nv1' },
    ]))
    expect(await screen.findByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(wizardApi.prepareRecordingScript).toHaveBeenCalledTimes(1)
    expect(wizardApi.prepareRecordingScript).toHaveBeenCalledWith('book-1')
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    expect(screen.queryByText(/will use default audition/)).not.toBeInTheDocument()
  })

  it('reuses the cached final script when Generate opens again', async () => {
    await open()

    expect(screen.getByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(wizardApi.prepareRecordingScript).not.toHaveBeenCalled()
  })

  it('prepares a missing final script before showing Generate', async () => {
    const unprepared = {
      ...base,
      activeArtifacts: { ...base.activeArtifacts, script: undefined },
      recordingScript: undefined,
      generatedChapters: [],
    }
    await open(unprepared, undefined, undefined, base)

    expect(wizardApi.prepareRecordingScript).toHaveBeenCalledWith('book-1')
    expect(screen.getByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(screen.queryByText(/Preparing your final script|Opening Generate/)).not.toBeInTheDocument()
  })

  it('keeps stale audio playable and offers a plain-language regeneration path', async () => {
    const snapshot: WizardSnapshot = {
      ...base,
      generatedChapters: [{ ...base.generatedChapters[0], current: false, staleReasons: ['cast:c1->c2'], revisions: [{ revision: 'audio-1', segments: 1, inputRevisions: { cast: 'c1' } }] }],
    }
    await open(snapshot)
    const staleChapter = screen.getByRole('heading', { name: 'Down the Rabbit-Hole' }).closest<HTMLElement>('.chapter-card')!
    expect(staleChapter).toHaveClass('stale')
    expect(within(staleChapter).getByText('Needs update')).toBeInTheDocument()
    expect(screen.queryByText(/Regenerate/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open WAV/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Listen to Down the Rabbit-Hole (older recording)' }))
    const player = screen.getByRole('dialog', { name: 'Down the Rabbit-Hole' })
    expect(within(player).getByText('Older recording')).toBeInTheDocument()
    expect(player.querySelector('audio')).toHaveAttribute('src', '/chapter.wav')
    fireEvent.click(within(player).getByRole('button', { name: 'Close player' }))
    expect(screen.getByRole('button', { name: /^Generate 1 selected →$/ })).toBeInTheDocument()
    expect(screen.queryByText(/cast:c1->c2/)).not.toBeInTheDocument()
    expect(screen.queryByText('Version history')).not.toBeInTheDocument()
    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it.each(['result', 'payload'] as const)('opens the completed persisted job book from its %s after refresh', async (context) => {
    localStorage.setItem('meowdiobooks.activeJob', 'job-1')
    vi.mocked(wizardApi.getJob).mockResolvedValue({
      id: 'job-1', status: 'succeeded',
      payload: context === 'payload' ? { book_id: 'book-1' } : {},
      result: context === 'result' ? { bookId: 'book-1' } : {},
    })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base)
    vi.mocked(wizardApi.prepareRecordingScript).mockResolvedValue(base.recordingScript!)
    vi.mocked(wizardApi.getRepresentativePages).mockResolvedValue([{ page: 1, reason: 'opening' }])
    vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Wizard stages' })).toBeInTheDocument()
    expect(screen.getByText('Step 5 · Generate')).toBeInTheDocument()
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it.each(['result', 'payload'] as const)('restores a successful generation selection from its %s after refresh', async (context) => {
    localStorage.setItem('meowdiobooks.activeJob', 'saved-generation')
    vi.mocked(wizardApi.getJob).mockResolvedValue({
      id: 'saved-generation', kind: 'v2:generate', status: 'succeeded',
      payload: { book_id: 'book-1', ...(context === 'payload' ? { settings: { chapterIds: ['chapter-1'] } } : {}) },
      result: context === 'result' ? { bookId: 'book-1', chapters: [{ chapterId: 'chapter-1', revision: 'audio-1' }] } : {},
    })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base)
    vi.mocked(wizardApi.getRepresentativePages).mockResolvedValue([{ page: 1, reason: 'opening' }])
    vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })
    render(<App />)

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked())
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Export →' }))
    expect(screen.getByRole('checkbox', { name: 'Chapter 01, 11 sec' })).toBeChecked()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it.each(['succeeded', 'failed'] as const)('restores the saved Cast candidate for a %s reattached job', async (status) => {
    const candidate: CastArtifact = {
      revision: 'cast-proposal-1', phase: 'identity-review', dossiers: [], proposals: [],
      detectedLanguage: 'english',
    }
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r1' },
      cast: undefined, recordingScript: undefined, generatedChapters: [],
      pendingCandidates: { cast: { revision: 'cast-proposal-1' } },
      recoverableStages: status === 'failed' ? { cast: {
        attempt: 2, message: 'Completed voices are saved.', modelId: 'qwen',
        language: 'english', proposalRevision: 'cast-proposal-1',
      } } : undefined,
    }
    localStorage.setItem('meowdiobooks.activeJob', 'cast-job')
    window.history.replaceState({}, '', '/library')
    vi.mocked(wizardApi.getJob).mockResolvedValue({
      id: 'cast-job', kind: 'v2:cast', status, payload: { book_id: 'book-1' },
      error: status === 'failed' ? 'Provider interrupted; completed voices are saved.' : undefined,
    })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue(candidate)
    vi.mocked(wizardApi.getRepresentativePages).mockResolvedValue([{ page: 1, reason: 'opening' }])
    vi.mocked(wizardApi.previewExtraction).mockResolvedValue({ page: 1, pageCount: 120, method: 'liteparse', text: 'Alice', warnings: [], elapsedSeconds: .1, cached: true, imageUrl: '/page.png' })
    render(<App />)
    expect(await screen.findByRole('navigation', { name: 'Wizard stages' })).toBeInTheDocument()
    expect(screen.getByText('Step 4 · Cast & voices')).toBeInTheDocument()
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'cast', 'cast-proposal-1')
    expect(window.location.pathname).toBe('/')
    if (status === 'failed') {
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
      expect(screen.getByRole('button', { name: 'Continue voice generation →' })).toBeInTheDocument()
    }
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })
  it('returns to the selected finished step after the active-job marker has been cleared', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Dialogue Complete' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('meowdiobooks.workflowLocation')!).stepId).toBe('dialogue'))
    const { cleanup } = await import('@testing-library/react')
    cleanup()
    render(<App />)
    expect(await screen.findByText('Transcript ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dialogue Complete' })).toHaveAttribute('aria-current', 'step')
    expect(wizardApi.getJob).not.toHaveBeenCalled()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
    expect(wizardApi.previewExtraction).not.toHaveBeenCalled()
  })

  it('starts independent pending candidate and Dialogue preview reads together after the authoritative snapshot', async () => {
    const snapshot: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract'] },
      pendingCandidates: {
        extraction: { revision: 'e-pending' }, dialogue: { revision: 'd-pending' },
        review: { revision: 'r-pending' }, cast: { revision: 'c-pending' },
      },
    }
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getStageCandidate).mockImplementation(async (_bookId, stage, revision) => {
      await waiting
      return stage === 'cast' ? base.cast! : { revision, spans: [], resultSummary: {}, warnings: [] }
    })
    vi.mocked(wizardApi.previewDialogue).mockImplementation(async () => { await waiting; return base.dialogue! })
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'dialogue' }} />)
    // None of the five reads resolves yet: a waterfall cannot reach this point.
    await waitFor(() => expect(wizardApi.getStageCandidate).toHaveBeenCalledTimes(4))
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledTimes(1)
    expect(wizardApi.previewDialogue).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('navigation', { name: 'Wizard stages' })).not.toBeInTheDocument()
    release()
    expect(await screen.findByRole('navigation', { name: 'Wizard stages' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('keeps a candidate read failure retryable without publishing an incomplete hydrated view', async () => {
    const snapshot: WizardSnapshot = { ...base, pendingCandidates: {
      extraction: { revision: 'e-pending' }, review: { revision: 'r-pending' },
    } }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getStageCandidate).mockRejectedValue(new Error('Saved candidate unavailable'))
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate' }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
    expect(wizardApi.getStageCandidate).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('heading', { name: 'Record your chapters' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(localStorage.getItem('meowdiobooks.workflowLocation')).toBeNull()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('restores one authenticated generation request before showing its pending selection or progress', async () => {
    const snapshot: WizardSnapshot = { ...base, generatedChapters: [],
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears' }],
    }
    let revealJob!: (job: Job) => void
    let finish!: (job: Job) => void
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getJob)
      .mockImplementationOnce(() => new Promise(resolve => { revealJob = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'resumed-one' }} />)
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(1))
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledWith('book-1')
    expect(screen.queryByRole('heading', { name: 'Record your chapters' })).not.toBeInTheDocument()
    revealJob({ id: 'resumed-one', kind: 'v2:generate', status: 'running', progress: 20,
      started_at: new Date().toISOString(),
      payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1', 'chapter-1', 'unknown', 1] } },
    })
    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(within(dialog).getByText('0 of 1 ready')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Down the Rabbit-Hole')).toBeChecked()
    expect(screen.getByLabelText('Select The Pool of Tears')).not.toBeChecked()
    expect(document.querySelector('.workspace')).toHaveAttribute('inert')
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, generatedChapters: base.generatedChapters })
    // Terminal snapshots can omit payload. The first authenticated scope still wins.
    finish({ id: 'resumed-one', status: 'succeeded' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Generated 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select The Pool of Tears' })).not.toBeInTheDocument()
    // Portal removal can precede the passive scroll-lock cleanup in React.
    await waitFor(() => {
      expect(document.querySelector('.workspace')).not.toHaveAttribute('inert')
      expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
    })
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it.each(['failed', 'canceled'] as const)('cleans resumed progress and selects only unfinished requested chapters after partial %s work', async (status) => {
    const snapshot: WizardSnapshot = { ...base, generatedChapters: [],
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears' }, { id: 'chapter-3', title: 'A Caucus-Race' }],
    }
    let finish!: (job: Job) => void
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getJob).mockResolvedValueOnce({ id: 'resumed-partial', kind: 'v2:generate', status: 'running',
      payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1', 'chapter-2'] } },
    }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(wizardApi.cancelJob).mockResolvedValue({ id: 'resumed-partial', kind: 'v2:generate', status: 'running', cancel_requested_at: new Date().toISOString() })
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'resumed-partial' }} />)
    const dialog = await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    expect(within(dialog).getByText('0 of 2 ready')).toBeInTheDocument()
    expect(screen.getByLabelText('Select A Caucus-Race')).not.toBeChecked()
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    if (status === 'canceled') {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel audio generation' }))
      await waitFor(() => expect(wizardApi.cancelJob).toHaveBeenCalledWith('resumed-partial'))
      expect(within(dialog).getByRole('button', { name: 'Canceling…' })).toBeDisabled()
    }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...snapshot, generatedChapters: base.generatedChapters })
    finish({ id: 'resumed-partial', kind: 'v2:generate', status, error: 'Stopped after saving Chapter 1.' })
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select The Pool of Tears' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select A Caucus-Race' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate 1 selected →' })).toBeEnabled()
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('keeps a track published before reattachment out of a resumed partial-failure retry', async () => {
    const snapshot: WizardSnapshot = { ...base,
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears' }, { id: 'chapter-3', title: 'A Caucus-Race' }],
    }
    let finish!: (job: Job) => void
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getJob).mockResolvedValueOnce({ id: 'already-partial', kind: 'v2:generate', status: 'running',
      payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1', 'chapter-2'] } },
    }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'already-partial' }} />)
    await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    finish({ id: 'already-partial', kind: 'v2:generate', status: 'failed', error: 'Chapter 2 failed.' })
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select The Pool of Tears' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select A Caucus-Race' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate 1 selected →' })).toBeEnabled()
  })

  it.each(['failed', 'canceled'] as const)('selects already-current requested recordings for Export after a resumed %s job without replaying it', async status => {
    const snapshot: WizardSnapshot = { ...base,
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears' }],
    }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getJob).mockResolvedValue({ id: 'legacy-replacement', kind: 'v2:generate', status,
      error: 'The previous recording is still available.',
      payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1'] } },
    })
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'legacy-replacement' }} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('tab', { name: 'Generated 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select The Pool of Tears' })).not.toBeInTheDocument()
    expect(screen.queryByText('More options')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Regenerate|^Generate \d/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Export →' }))
    expect(screen.getByRole('checkbox', { name: 'Chapter 01, 11 sec' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create high-quality M4B →' }))
    await waitFor(() => expect(wizardApi.createAudioExport).toHaveBeenCalledWith('book-1', [{ chapterId: 'chapter-1', revision: 'audio-1' }], expect.anything()))
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('clears resumed generation tracking after a permanent polling failure', async () => {
    let fail!: (reason: Error) => void
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...base, generatedChapters: [] })
    vi.mocked(wizardApi.getJob).mockResolvedValueOnce({ id: 'expired-generation', kind: 'v2:generate', status: 'running',
      payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1'] } },
    }).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'expired-generation' }} />)
    await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    fail(Object.assign(new Error('Job no longer exists'), { status: 404 }))
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked()
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('uses neutral resumed progress for a legacy generation job with unknown chapter scope', async () => {
    const snapshot: WizardSnapshot = { ...base, generatedChapters: [],
      chapters: [...base.chapters, { id: 'chapter-2', title: 'The Pool of Tears' }],
    }
    let finish!: (job: Job) => void
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getJob).mockResolvedValueOnce({ id: 'legacy-generation', kind: 'v2:generate', status: 'running', payload: { book_id: 'book-1' } })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'legacy-generation' }} />)
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelector('.generation-overlay')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Select Down the Rabbit-Hole')).not.toBeChecked()
    expect(screen.getByLabelText('Select The Pool of Tears')).not.toBeChecked()
    view.unmount()
    finish({ id: 'legacy-generation', kind: 'v2:generate', status: 'succeeded' })
    await waitFor(() => expect(document.body).not.toHaveStyle({ overflow: 'hidden' }))
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledTimes(1)
  })

  it('clears resumed generation UI on account change and ignores its late completion', async () => {
    const snapshot: WizardSnapshot = { ...base, generatedChapters: [] }
    let finish!: (job: Job) => void
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(snapshot)
    vi.mocked(wizardApi.getJob).mockResolvedValueOnce({ id: 'account-a-generation', kind: 'v2:generate', status: 'running',
      payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1'] } },
    }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const initial = { bookId: 'book-1', stepId: 'generate', activeJobId: 'account-a-generation' }
    const view = render(<App workflowPersistenceNamespace="account-a" initialWorkflowLocation={initial} />)
    await screen.findByRole('dialog', { name: 'Making your selected chapters…' })
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    view.rerender(<App workflowPersistenceNamespace="account-b" />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    finish({ id: 'account-a-generation', kind: 'v2:generate', status: 'succeeded' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Record your chapters' })).not.toBeInTheDocument())
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(workflowStorageKey('activeJob', 'account-b'))).toBeNull()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('hydrates the running job book before completion and returns to its saved pending Dialogue result', async () => {
    persistWorkflowReturn('book-1', 'dialogue', { activeJobId: 'dialogue-running' })
    const pending: WizardSnapshot = { ...base, book: { ...base.book, completedStages: ['import', 'extract'] },
      pendingCandidates: { dialogue: { revision: 'dialogue-saved', status: 'candidate' } } }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValueOnce({ ...pending, pendingCandidates: undefined }).mockResolvedValue(pending)
    vi.mocked(wizardApi.previewDialogue).mockResolvedValue(base.dialogue!)
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'dialogue-saved', spans: [], resultSummary: { explicitTurns: 1, aiAttributed: 0, unresolved: 0 } })
    let finish!: (job: Job) => void
    vi.mocked(wizardApi.getJob).mockResolvedValueOnce({ id: 'dialogue-running', kind: 'v2:dialogue', status: 'running', payload: { book_id: 'book-1' } })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<App />)
    await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('navigation', { name: 'Wizard stages' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dialogue In progress' })).toHaveAttribute('aria-current', 'step')
    finish({ id: 'dialogue-running', kind: 'v2:dialogue', status: 'succeeded', payload: { book_id: 'book-1' } })
    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull())
    view.unmount()
    render(<App />)
    expect(await screen.findByText('Your transcript is ready')).toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it.each(['home', 'library'])('honors explicit %s navigation over an old running-job marker on reload', async (destination) => {
    await open()
    if (destination === 'home') fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }))
    else fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('meowdiobooks.workflowLocation')!).view).toBe(destination === 'home' ? 'create' : 'library'))
    localStorage.setItem('meowdiobooks.activeJob', 'old-job')
    const { cleanup } = await import('@testing-library/react')
    cleanup()
    vi.mocked(wizardApi.getBookSnapshot).mockClear()
    render(<App />)
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Wizard stages' })).not.toBeInTheDocument())
    expect(wizardApi.getJob).not.toHaveBeenCalled()
    expect(wizardApi.getBookSnapshot).not.toHaveBeenCalled()
    if (destination === 'library') expect(await screen.findByRole('heading', { name: 'Your audiobooks' })).toBeInTheDocument()
    else expect(await screen.findByRole('button', { name: /Alice.*Continue/ })).toBeInTheDocument()
  })

  it.each(['Go to Home', 'Library'])('does not override %s navigation when an old restore finishes late', async (destination) => {
    persistWorkflowReturn('book-1', 'generate')
    let finish!: (snapshot: WizardSnapshot) => void
    vi.mocked(wizardApi.getBookSnapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: destination }))
    finish(base)
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Wizard stages' })).not.toBeInTheDocument())
    expect(screen.queryByText('Record your chapters')).not.toBeInTheDocument()
  })

  it('scopes return hints to the host account and ignores unscoped legacy jobs', async () => {
    persistWorkflowReturn('book-1', 'generate', { namespace: 'account-a', activeJobId: 'account-a-job' })
    localStorage.setItem('meowdiobooks.activeJob', 'legacy-job')
    render(<App workflowPersistenceNamespace="account-b" />)
    await waitFor(() => expect(screen.queryByText('Loading books…')).not.toBeInTheDocument())
    expect(wizardApi.getJob).not.toHaveBeenCalled()
    expect(wizardApi.getBookSnapshot).not.toHaveBeenCalled()
    expect(localStorage.getItem(workflowStorageKey('activeJob', 'account-a'))).toBe('account-a-job')
  })

  it('ignores the previous account snapshot when identity changes during restore', async () => {
    persistWorkflowReturn('book-1', 'generate', { namespace: 'account-a' })
    let finish!: (snapshot: WizardSnapshot) => void
    vi.mocked(wizardApi.getBookSnapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<App workflowPersistenceNamespace="account-a" />)
    view.rerender(<App workflowPersistenceNamespace="account-b" />)
    finish(base)
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Wizard stages' })).not.toBeInTheDocument())
    expect(localStorage.getItem(workflowStorageKey('location', 'account-b')) ?? '').not.toContain('book-1')
  })

  it('retains a failed return hint and retries a temporary snapshot outage', async () => {
    persistWorkflowReturn('book-1', 'generate')
    vi.mocked(wizardApi.getBookSnapshot).mockRejectedValueOnce(Object.assign(new Error('Temporarily offline'), { status: 503 })).mockResolvedValue(base)
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The connection was interrupted. Check your connection and try again. Your accepted work is unchanged.')
    expect(localStorage.getItem('meowdiobooks.workflowLocation')).toContain('book-1')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a deleted book return and old job marker instead of trapping the user', async () => {
    persistWorkflowReturn('book-removed', 'dialogue', { activeJobId: 'removed-job' })
    vi.mocked(wizardApi.getBookSnapshot).mockRejectedValueOnce(Object.assign(new Error('Book not found'), { status: 404 }))
    render(<App />)
    await waitFor(() => expect(localStorage.getItem('meowdiobooks.workflowLocation')).not.toContain('book-removed'))
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(wizardApi.getJob).not.toHaveBeenCalled()
  })

  it('keeps the useful book available when its remembered job has disappeared', async () => {
    persistWorkflowReturn('book-1', 'generate', { activeJobId: 'removed-job' })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base)
    vi.mocked(wizardApi.getJob).mockRejectedValueOnce(Object.assign(new Error('Job not found'), { status: 404 }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
    expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull()
    expect(localStorage.getItem('meowdiobooks.workflowLocation')).toContain('book-1')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('restores a finished pending Review scan without running it again', async () => {
    persistWorkflowReturn('book-1', 'review')
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      pendingCandidates: { review: { revision: 'review-ready', status: 'candidate' } },
    })
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-ready', warnings: [], boundaryCandidates: [] })
    render(<App />)
    await screen.findByRole('navigation', { name: 'Wizard stages' })
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'review', 'review-ready')
    expect(screen.queryByRole('button', { name: /Scan for issues/ })).not.toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('ignores an old job marker for another book while restoring the saved current book', async () => {
    persistWorkflowReturn('book-1', 'generate', { activeJobId: 'another-book-job' })
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base)
    vi.mocked(wizardApi.getJob).mockResolvedValue({ id: 'another-book-job', status: 'running', payload: { book_id: 'another-book' } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Record your chapters' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull())
    expect(wizardApi.getBookSnapshot).not.toHaveBeenCalledWith('another-book')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns to a completed Extraction candidate after reload and accepts it without rerunning the parser', async () => {
    persistWorkflowReturn('book-1', 'extract', { activeJobId: 'extraction-finished' })
    const pending: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import'] },
      pendingCandidates: { extraction: { revision: 'extract-ready', status: 'candidate' } },
    }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(pending)
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'extract-ready', method: 'native' })
    vi.mocked(wizardApi.getJob).mockResolvedValue({ id: 'extraction-finished', kind: 'v2:extract', status: 'succeeded', payload: { book_id: 'book-1' }, result: { revision: 'extract-ready' } })
    const first = render(<App />)
    expect(await screen.findByRole('button', { name: 'Accept completed extraction →' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull())
    first.unmount()
    render(<App />)
    const accept = await screen.findByRole('button', { name: 'Accept completed extraction →' })
    expect(wizardApi.previewExtraction).not.toHaveBeenCalled()
    expect(wizardApi.acceptStage).not.toHaveBeenCalled()
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...pending,
      book: { ...pending.book, completedStages: ['import', 'extract'] }, pendingCandidates: undefined,
    })
    vi.mocked(wizardApi.previewDialogue).mockResolvedValue(base.dialogue!)
    fireEvent.click(accept)
    await waitFor(() => expect(wizardApi.acceptStage).toHaveBeenCalledWith('book-1', 'extract', 'extract-ready', []))
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it('honors an explicit initial Library URL over a saved book destination', async () => {
    persistWorkflowReturn('book-1', 'generate', { activeJobId: 'saved-job' })
    window.history.replaceState({}, '', '/library')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your audiobooks' })).toBeInTheDocument()
    expect(wizardApi.getBookSnapshot).not.toHaveBeenCalled()
    expect(wizardApi.getJob).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/library')
  })

  it('retains the return destination when a candidate lookup fails with 404', async () => {
    persistWorkflowReturn('book-1', 'cast')
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue({ ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue', 'review'] },
      pendingCandidates: { cast: { revision: 'missing-candidate', status: 'candidate' } },
    })
    vi.mocked(wizardApi.getStageCandidate).mockRejectedValueOnce(Object.assign(new Error('Candidate not found'), { status: 404 }))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while completing this step. Try again; your accepted work is unchanged.')
    expect(localStorage.getItem('meowdiobooks.workflowLocation')).toContain('book-1')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('discards a late manual book open when the host account changes', async () => {
    vi.mocked(wizardApi.listBooks).mockResolvedValueOnce([{ id: 'book-1', title: 'Alice', source_name: 'alice.pdf', source_kind: 'pdf', page_count: 120 }]).mockResolvedValue([])
    let finish!: (snapshot: WizardSnapshot) => void
    vi.mocked(wizardApi.getBookSnapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<App workflowPersistenceNamespace="account-a" />)
    fireEvent.click(await screen.findByRole('button', { name: /Alice.*Continue/ }))
    view.rerender(<App workflowPersistenceNamespace="account-b" />)
    finish(base)
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Wizard stages' })).not.toBeInTheDocument())
    expect(screen.queryByText('Record your chapters')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
    expect(localStorage.getItem(workflowStorageKey('location', 'account-b')) ?? '').not.toContain('book-1')
  })

  it('reattaches a completed Review job and retains its ready scan after the job marker is cleared', async () => {
    persistWorkflowReturn('book-1', 'review', { activeJobId: 'review-finished' })
    const pending: WizardSnapshot = { ...base,
      book: { ...base.book, completedStages: ['import', 'extract', 'dialogue'] },
      pendingCandidates: { review: { revision: 'review-ready', status: 'candidate' } },
    }
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValueOnce({ ...pending, pendingCandidates: undefined }).mockResolvedValue(pending)
    vi.mocked(wizardApi.getStageCandidate).mockResolvedValue({ revision: 'review-ready', warnings: [], boundaryCandidates: [] })
    vi.mocked(wizardApi.getJob).mockResolvedValue({ id: 'review-finished', kind: 'v2:review', status: 'succeeded', payload: { book_id: 'book-1' }, result: { revision: 'review-ready' } })
    const first = render(<App />)
    await waitFor(() => expect(localStorage.getItem('meowdiobooks.activeJob')).toBeNull())
    await screen.findByRole('button', { name: 'Review Draft ready' })
    expect(wizardApi.getStageCandidate).toHaveBeenCalledWith('book-1', 'review', 'review-ready')
    expect(screen.queryByRole('button', { name: /Scan for issues/ })).not.toBeInTheDocument()
    first.unmount()
    render(<App />)
    await screen.findByRole('navigation', { name: 'Wizard stages' })
    expect(screen.getByRole('button', { name: 'Review Draft ready' })).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('button', { name: /Scan for issues/ })).not.toBeInTheDocument()
    expect(wizardApi.processStage).not.toHaveBeenCalled()
  })

  it.each(['synchronous', 'queued'])('shows a host action without global or inline generation failure for %s work', async (mode) => {
    const action = { code: 'HOST_REVIEW_REQUIRED', message: 'Review before continuing.', context: { bookId: 'book-1', stage: 'generate' } };
    const onActionRequired = vi.fn().mockReturnValue(true);
    if (mode === 'synchronous') vi.mocked(wizardApi.processStage).mockRejectedValue(new ActionRequiredError(action));
    else vi.mocked(wizardApi.processStage).mockResolvedValue({ id: 'blocked-generation', kind: 'v2:generate', status: 'failed',
      error: 'Review before continuing.', action_required: action, payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1'], language: 'english' } } });
    await open({ ...base, generatedChapters: [] }, undefined, undefined, undefined, { onActionRequired });
    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }));
    await waitFor(() => expect(onActionRequired).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Making your selected chapters…' })).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Review before continuing.')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Down the Rabbit-Hole' })).toBeChecked();
    expect(wizardApi.processStage).toHaveBeenCalledTimes(1);
    if (mode === 'queued') expect(onActionRequired).toHaveBeenCalledWith(action, expect.objectContaining({ jobId: 'blocked-generation', stage: 'generate', settings: { chapterIds: ['chapter-1'], language: 'english' } }));
  });

  it('keeps required action feedback visible when no host handles it', async () => {
    const action = { code: 'HOST_REVIEW_REQUIRED', message: 'Review before continuing.', context: {} };
    vi.mocked(wizardApi.processStage).mockRejectedValue(new ActionRequiredError(action));
    await open({ ...base, generatedChapters: [] });
    fireEvent.click(screen.getByRole('button', { name: /^Generate 1 selected →$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(action.message);
  });

  it('restores a failed job action and its exact selected step without re-running work', async () => {
    const action = { code: 'HOST_REVIEW_REQUIRED', message: 'Review before continuing.', context: { bookId: 'book-1' } };
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base);
    vi.mocked(wizardApi.getJob).mockResolvedValue({ id: 'saved-job', kind: 'v2:generate', status: 'failed', error: action.message,
      action_required: action, payload: { book_id: 'book-1', settings: { chapterIds: ['chapter-1'] } } });
    const handler = vi.fn().mockReturnValue(true);
    render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'saved-job' }} onActionRequired={handler} />);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Record your chapters')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(wizardApi.processStage).not.toHaveBeenCalled();
  });

  it('uses an explicit host job return when browser storage is unavailable', async () => {
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base);
    vi.mocked(wizardApi.getJob).mockResolvedValue({ id: 'host-dispatched', kind: 'v2:generate', status: 'succeeded', payload: { book_id: 'book-1' } });
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    try {
      render(<App initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate', activeJobId: 'host-dispatched' }} />);
      expect(await screen.findByText('Record your chapters')).toBeInTheDocument();
      await waitFor(() => expect(wizardApi.getJob).toHaveBeenCalledWith('host-dispatched'));
      expect(wizardApi.processStage).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it('discards an initial host return hint when the identity changes without a remount', async () => {
    vi.mocked(wizardApi.getBookSnapshot).mockResolvedValue(base);
    const view = render(<App workflowPersistenceNamespace="account-a" initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate' }} />);
    expect(await screen.findByText('Record your chapters')).toBeInTheDocument();
    const previous = vi.mocked(wizardApi.getBookSnapshot).mock.calls.length;
    view.rerender(<App workflowPersistenceNamespace="account-b" initialWorkflowLocation={{ bookId: 'book-1', stepId: 'generate' }} />);
    await waitFor(() => expect(screen.queryByText('Record your chapters')).not.toBeInTheDocument());
    expect(wizardApi.getBookSnapshot).toHaveBeenCalledTimes(previous);
    expect(localStorage.getItem(workflowStorageKey('location', 'account-b')) ?? '').not.toContain('book-1');
  });

})
