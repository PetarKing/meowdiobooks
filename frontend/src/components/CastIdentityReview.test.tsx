import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CastArtifact } from "../api/contracts";
import type { IdentityDecision } from "../castIdentity";
import { castFor } from "../../design-kit/castFixtures";
import { CastIdentityReview } from "./CastIdentityReview";

const cast: CastArtifact = {
  revision: "cast-1",
  phase: "identity-review",
  dossiers: [
    { label: "Cecilus", occurrenceCount: 8, examples: [{ page: 2, source: "Cecilus: Run!" }] },
    { label: "Cecilus Segmunt", occurrenceCount: 3, examples: [{ page: 9, source: "Cecilus Segmunt: Faster!" }] },
    { label: "Emilia", occurrenceCount: 6, examples: [{ page: 4, source: "Emilia: Be careful." }] },
  ],
  proposals: [
    { label: "Cecilus", category: "character", canonicalName: "Cecilus", competingLabels: ["Cecilus Segmunt"], reviewRequired: true, reason: "Possibly shortened." },
    { label: "Cecilus Segmunt", category: "character", canonicalName: "Cecilus Segmunt", reviewRequired: true, reason: "Possibly the same speaker." },
    { label: "Emilia", category: "character", canonicalName: "Emilia", reviewRequired: false, reason: "Consistent label." },
  ],
};

function Harness({ onReclassify }: { onReclassify?: () => void } = {}) {
  const [decisions, setDecisions] = useState<Record<string, IdentityDecision>>(Object.fromEntries(
    cast.proposals.map((row) => [row.label, { label: row.label, category: row.category, canonicalName: row.canonicalName, aliases: [], primaryLabel: row.label }]),
  ));
  const [resolved, setResolved] = useState(["Emilia"]);
  return <>
    <CastIdentityReview cast={cast} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolved} setResolvedLabels={setResolved} voiceModels={[{ id: "qwen", label: "Qwen", supportedLanguages: ["english"] }]} voiceModel="qwen" language="english" onVoiceModelChange={() => undefined} onLanguageChange={() => undefined} onReclassify={onReclassify} />
    <output data-testid="decisions">{JSON.stringify(decisions)}</output>
  </>;
}

function FixtureHarness() {
  const fixture = castFor("identity-review");
  const [decisions, setDecisions] = useState<Record<string, IdentityDecision>>(Object.fromEntries(
    fixture.proposals.map((row) => [row.label, { label: row.label, category: row.category, canonicalName: row.canonicalName, aliases: [], primaryLabel: row.label }]),
  ));
  const [resolved, setResolved] = useState<string[]>([]);
  return <CastIdentityReview cast={fixture} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolved} setResolvedLabels={setResolved} voiceModels={[]} voiceModel="" language="english" onVoiceModelChange={() => undefined} onLanguageChange={() => undefined} hideVoiceSettings />;
}

function OverloadedHarness() {
  const overloaded: CastArtifact = {
    revision: "cast-overloaded",
    phase: "identity-review",
    dossiers: ["One", "Two", "Three", "Four"].map((label) => ({ label, occurrenceCount: 1, examples: [{ source: `${label}: Hello.` }] })),
    proposals: ["One", "Two", "Three", "Four"].map((label) => ({ label, category: "character", canonicalName: "One", reviewRequired: true })),
  };
  const [decisions, setDecisions] = useState<Record<string, IdentityDecision>>(Object.fromEntries(
    overloaded.proposals.map((row) => [row.label, { label: row.label, category: row.category, canonicalName: "One", aliases: [], primaryLabel: "One" }]),
  ));
  const [resolved, setResolved] = useState<string[]>([]);
  return <CastIdentityReview cast={overloaded} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolved} setResolvedLabels={setResolved} voiceModels={[{ id: "qwen", label: "Qwen", supportedLanguages: ["english"] }]} voiceModel="qwen" language="english" onVoiceModelChange={() => undefined} onLanguageChange={() => undefined} />;
}

function ReviewSignalsHarness({ reused = false }: { reused?: boolean } = {}) {
  const signalCast: CastArtifact = {
    revision: "cast-signals",
    ...(reused ? { previousVoiceMatches: { "Blue Lightning": { bookTitle: "Prior book" }, "fake Cecilus": { bookTitle: "Prior book" } } } : {}),
    phase: "identity-review",
    dossiers: [
      { label: "Blue Lightning", occurrenceCount: 8, examples: [] },
      { label: "Cecilus Segmunt", occurrenceCount: 3, examples: [] },
      { label: "fake Cecilus", occurrenceCount: 1, examples: [] },
    ],
    proposals: [
      { label: "Blue Lightning", category: "character", canonicalName: "Cecilus Segmunt", aliases: ["Cecilus Segmunt"], reviewRequired: true },
      { label: "Cecilus Segmunt", category: "character", canonicalName: "Cecilus Segmunt", aliases: ["Blue Lightning"], reviewRequired: true },
      { label: "fake Cecilus", category: "character", canonicalName: "fake Cecilus", competingLabels: ["Blue Lightning"], reviewRequired: true },
    ],
  };
  const [decisions, setDecisions] = useState<Record<string, IdentityDecision>>({
    "Blue Lightning": { label: "Blue Lightning", category: "character", canonicalName: "Cecilus Segmunt", aliases: [], primaryLabel: "Cecilus Segmunt" },
    "Cecilus Segmunt": { label: "Cecilus Segmunt", category: "character", canonicalName: "Cecilus Segmunt", aliases: [], primaryLabel: "Cecilus Segmunt" },
    "fake Cecilus": { label: "fake Cecilus", category: "character", canonicalName: "fake Cecilus", aliases: [], primaryLabel: "fake Cecilus" },
  });
  const [resolved, setResolved] = useState<string[]>([]);
  return <CastIdentityReview cast={signalCast} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolved} setResolvedLabels={setResolved} voiceModels={[{ id: "qwen", label: "Qwen", supportedLanguages: ["english"] }]} voiceModel="qwen" language="english" onVoiceModelChange={() => undefined} onLanguageChange={() => undefined} />;
}

function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
  };
}

function dragOverAt(target: Element, clientY: number, dataTransfer: ReturnType<typeof transfer>) {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: { value: dataTransfer },
  });
  fireEvent(target, event);
}

function EnsembleHarness() {
  const ensemble: CastArtifact = { revision: "ensemble", phase: "identity-review", dossiers: [], proposals: Array.from({ length: 14 }, (_, index) => ({ label: index === 0 ? "Moonlight" : `Label ${index}`, category: index === 0 ? "group" : "character", canonicalName: index === 0 ? "Émilia" : `Member ${index}`, reviewRequired: index === 0 })) };
  const [decisions, setDecisions] = useState<Record<string, IdentityDecision>>(Object.fromEntries(ensemble.proposals.map((row) => [row.label, { label: row.label, category: row.category, canonicalName: row.canonicalName, aliases: [], primaryLabel: row.label }])));
  const [resolved, setResolved] = useState<string[]>([]);
  return <CastIdentityReview cast={ensemble} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolved} setResolvedLabels={setResolved} voiceModels={[]} voiceModel="" language="english" onVoiceModelChange={vi.fn()} onLanguageChange={vi.fn()} hideVoiceSettings />;
}

describe("CastIdentityReview", () => {
  it("filters a large cast by source labels and review state", () => {
    render(<EnsembleHarness />);
    const search = screen.getByRole("searchbox", { name: "Search cast" });
    fireEvent.change(search, { target: { value: "moonLIGHT" } });
    expect(screen.getByRole("button", { name: "Inspect Émilia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect Member 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect Narrator" })).toBeInTheDocument();
    expect(screen.getByText("1 of 14 cast members shown")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Show cast" }), { target: { value: "ready" } });
    expect(screen.getByText("No cast members match these filters.")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("searchbox", { name: "Search cast" }).closest(".collection-toolbar")!).getByRole("button", { name: "Clear" }));
    expect(search).toHaveFocus();
    expect(screen.getByText("14 of 14 cast members shown")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Show cast" }), { target: { value: "required" } });
    expect(screen.getByRole("button", { name: "Inspect Émilia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect Member 1" })).not.toBeInTheDocument();
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps source passages intact while replacing technical generated explanations", () => {
    const technicalCast: CastArtifact = { ...cast,
      proposals: cast.proposals.map((row) => ({ ...row, reason: "Qwen API returned a JSON schema match" })),
      dossiers: cast.dossiers.map((row) => ({ ...row, examples: [{ source: "The model explained the API in this book." }] })),
    };
    render(<CastIdentityReview cast={technicalCast} decisions={{}} setDecisions={() => undefined} resolvedLabels={[]} setResolvedLabels={() => undefined} voiceModels={[]} voiceModel="" language="english" onVoiceModelChange={() => undefined} onLanguageChange={() => undefined} hideVoiceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Cecilus" }));
    const dialog = screen.getByRole("dialog", { name: "Inspect Cecilus" });
    expect(dialog).not.toHaveTextContent("Qwen API returned a JSON schema match");
    expect(dialog).toHaveTextContent("Check the examples before deciding whether these names belong together.");
    expect(dialog).toHaveTextContent("The model explained the API in this book.");
  });

  it("keeps reclassification hidden unless cast editing explicitly enables it", () => {
    const reclassify = vi.fn();
    const { rerender } = render(<Harness />);
    expect(screen.queryByRole("button", { name: "Reclassify from Dialogue" })).not.toBeInTheDocument();

    rerender(<Harness onReclassify={reclassify} />);
    const button = screen.getByRole("button", { name: "Reclassify from Dialogue" });
    expect(button).toHaveClass("danger-subtle");
    fireEvent.click(button);
    expect(reclassify).toHaveBeenCalledOnce();
  });

  it("keeps every hosted-model language available from the compact audio settings", () => {
    const supportedLanguages = ["chinese", "english", "french", "german", "italian", "japanese", "korean", "portuguese", "russian", "spanish"];
    const { rerender } = render(<Harness />);
    rerender(<CastIdentityReview
      cast={cast}
      decisions={{}}
      setDecisions={() => undefined}
      resolvedLabels={[]}
      setResolvedLabels={() => undefined}
      voiceModels={[{ id: "qwen-audio-3", label: "Alibaba Qwen Audio 3.0", supportedLanguages }]}
      voiceModel="qwen-audio-3"
      language="english"
      onVoiceModelChange={() => undefined}
      onLanguageChange={() => undefined}
    />);

    expect(screen.getByText("🇬🇧 english · Alibaba Qwen Audio 3.0")).toBeInTheDocument();
    expect(screen.getByLabelText("Voice model")).toHaveValue("qwen-audio-3");
    const languageGroup = screen.getByRole("group", { name: "Book language" });
    expect(within(languageGroup).getAllByRole("button")).toHaveLength(supportedLanguages.length);
    expect(within(languageGroup).getByRole("button", { name: "portuguese" })).toBeInTheDocument();
  });

  it("keeps mandatory and optional reviews ahead of prior-book provenance", () => {
    render(<ReviewSignalsHarness reused />);
    const required = screen.getByRole("button", { name: "Inspect Cecilus Segmunt" });
    expect(required).toHaveClass("needs-review", "previous-book-match");
    expect(required).toHaveTextContent(/Must review.*From prior book/);
    const optional = screen.getByRole("button", { name: "Inspect fake Cecilus" });
    expect(optional).toHaveClass("has-suggestions", "previous-book-match");
    expect(optional).not.toHaveClass("needs-review");
    expect(optional).toHaveTextContent(/Should review.*From prior book/);
    fireEvent.click(optional);
    expect(screen.getByRole("dialog", { name: "Inspect fake Cecilus" })).toHaveTextContent("Optional check");
  });

  it("blocks only material grouping decisions and keeps possible matches informational", () => {
    render(<ReviewSignalsHarness />);

    const autoGrouped = screen.getByRole("button", { name: "Inspect Cecilus Segmunt" });
    expect(autoGrouped).toHaveClass("auto-grouped");
    expect(autoGrouped).not.toHaveClass("qwen-review");
    expect(autoGrouped).toHaveTextContent("Must review");

    const possibleMatch = screen.getByRole("button", { name: "Inspect fake Cecilus" });
    expect(possibleMatch).toHaveClass("has-suggestions");
    expect(possibleMatch).not.toHaveClass("auto-grouped");
    expect(possibleMatch).not.toHaveTextContent("Required");
    expect(possibleMatch).toHaveTextContent("Should review");
    expect(screen.queryByText(/auto-grouped/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Qwen review|Qwen suggestion/i)).not.toBeInTheDocument();

    fireEvent.click(autoGrouped);
    expect(screen.getByRole("dialog", { name: "Inspect Cecilus Segmunt" })).toHaveTextContent("Required before continuing");
    fireEvent.click(screen.getByRole("button", { name: "Confirm grouping" }));
    expect(autoGrouped).not.toHaveClass("auto-grouped");

    fireEvent.click(possibleMatch);
    const possibleMatchDialog = screen.getByRole("dialog", { name: "Inspect fake Cecilus" });
    expect(possibleMatchDialog).toHaveTextContent("Optional check");
    expect(possibleMatchDialog).toHaveTextContent("You can continue without changing it.");
    expect(possibleMatchDialog).toHaveTextContent("Suggested matches");
    expect(within(possibleMatchDialog).queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("uses only the X once a cast member is reviewed", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Inspect Emilia" }));
    const reviewed = screen.getByRole("dialog", { name: "Inspect Emilia" });
    expect(reviewed).toHaveTextContent("Ready");
    expect(within(reviewed).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toContain("Close cast member");
    expect(within(reviewed).queryByRole("button", { name: "Accept suggestion" })).not.toBeInTheDocument();
  });

  it("organizes cast members around a pinned Narrator and cumulative evidence", () => {
    render(<Harness />);
    const board = screen.getByRole("region", { name: "Cast members" });
    expect(within(board).getAllByRole("button")).toHaveLength(4);
    const narrator = screen.getByRole("button", { name: "Inspect Narrator" });
    expect(narrator).not.toHaveAttribute("draggable", "true");
    expect(narrator).not.toHaveTextContent("Normal book prose");
    expect(narrator).not.toHaveTextContent("reassigned labels");

    fireEvent.click(narrator);
    const narratorDialog = screen.getByRole("dialog", { name: "Inspect Narrator" });
    expect(narratorDialog).toHaveTextContent("Permanent primary");
    expect(narratorDialog).not.toHaveTextContent("No speaker labels reassigned");
    expect(narratorDialog).not.toHaveTextContent("0 assigned");
    expect(narratorDialog).not.toHaveTextContent("0 dialogue lines");
    fireEvent.click(within(narratorDialog).getByRole("button", { name: "Close cast member" }));

    fireEvent.click(screen.getByRole("button", { name: "Inspect Cecilus" }));
    expect(screen.getByRole("dialog", { name: "Inspect Cecilus" })).toHaveTextContent("Cecilus: Run!");
    const suggestions = screen.getByRole("dialog", { name: "Inspect Cecilus" }).querySelector<HTMLDetailsElement>(".cast-match-panel")!;
    expect(suggestions).toHaveAttribute("open");
    expect(within(suggestions).getByRole("button", { name: "Attach" })).toBeInTheDocument();
  });

  it("shows actionable Queen suggestions in the grid and attaches a real source label", () => {
    render(<FixtureHarness />);
    const queen = screen.getByRole("button", { name: "Inspect Queen of Hearts" });
    expect(queen).toHaveClass("has-suggestions");
    expect(queen).not.toHaveClass("needs-review");
    fireEvent.click(queen);
    const inspector = screen.getByRole("dialog", { name: "Inspect Queen of Hearts" });
    expect(inspector).toHaveTextContent("Suggested matches");
    const suggestions = inspector.querySelector<HTMLDetailsElement>(".cast-match-panel")!;
    expect(suggestions).toHaveAttribute("open");
    expect(within(suggestions).getByText("Queen")).toBeInTheDocument();
    fireEvent.click(within(suggestions).getByRole("button", { name: "Attach" }));
    expect(within(inspector).getByText("Queen", { selector: ".cast-alias-card b" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect Queen" })).not.toBeInTheDocument();
    expect(queen).not.toHaveClass("needs-review");
    expect(within(inspector).queryByRole("button", { name: "Confirm grouping" })).not.toBeInTheDocument();
  });

  it("keeps the current cast member open when a secondary label is detached", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Cecilus" }));
    const suggestions = screen.getByRole("dialog", { name: "Inspect Cecilus" }).querySelector<HTMLDetailsElement>(".cast-match-panel")!;
    fireEvent.click(within(suggestions).getByRole("button", { name: "Attach" }));

    const dialog = screen.getByRole("dialog", { name: "Inspect Cecilus" });
    expect(dialog).toHaveTextContent("Should review");
    expect(within(dialog).queryByRole("button", { name: "Accept suggestion" })).not.toBeInTheDocument();
    const primaryCard = within(dialog).getByText("Primary label").closest("article")!;
    expect(within(primaryCard).getByText("Primary label")).toBeInTheDocument();
    expect(within(primaryCard).queryByRole("button", { name: "Detach" })).not.toBeInTheDocument();

    const detach = within(dialog).getByRole("button", { name: "Detach" });
    const secondaryCard = detach.closest("article")!;
    expect(secondaryCard).toHaveTextContent("Cecilus Segmunt");
    fireEvent.click(detach);
    expect(screen.getByRole("dialog", { name: "Inspect Cecilus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect Cecilus Segmunt" })).toBeInTheDocument();
  });

  it("searches source labels with one evidence line and attaches a result", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Cecilus" }));
    expect(within(screen.getByRole("list", { name: "Source label search results" })).queryAllByRole("listitem")).toHaveLength(0);
    const search = screen.getByRole("searchbox", { name: "Search source labels" });
    fireEvent.change(search, { target: { value: "missing" } });
    expect(within(screen.getByRole("list", { name: "Source label search results" })).queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.change(search, { target: { value: "careful emilia" } });

    const results = screen.getByRole("list", { name: "Source label search results" });
    expect(results).toHaveTextContent("Emilia: Be careful.");
    fireEvent.click(within(results).getByRole("button", { name: "Attach" }));
    expect(screen.getByRole("dialog", { name: "Inspect Cecilus" })).toHaveTextContent("Emilia: Be careful.");
  });

  it("marks an unresolved cast member with more than three labels as a suspicious merge", () => {
    render(<OverloadedHarness />);
    const tile = screen.getByRole("button", { name: "Inspect One" });
    expect(tile).toHaveClass("suspicious-merge");
    expect(tile).toHaveTextContent("Must review");
  });

  it("merges an entire dragged cast member into the drop target", () => {
    render(<Harness />);
    const source = screen.getByRole("button", { name: "Inspect Cecilus" });
    const target = screen.getByRole("button", { name: "Inspect Emilia" });
    const dataTransfer = transfer();

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(screen.queryByRole("button", { name: "Inspect Cecilus" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect Emilia" })).toHaveTextContent("14 lines");
    expect(JSON.parse(screen.getByTestId("decisions").textContent ?? "{}").Cecilus.canonicalName).toBe("Emilia");

    expect(screen.getByText("Merged Cecilus into Emilia.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Inspect Cecilus" })).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("decisions").textContent ?? "{}").Cecilus.canonicalName).toBe("Cecilus");
  });

  it("keeps the drop cue when moving between a card's children, then clears it on exit or cancellation", () => {
    render(<Harness />);
    const source = screen.getByRole("button", { name: "Inspect Cecilus" });
    const target = screen.getByRole("button", { name: "Inspect Emilia" });
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    const portrait = target.querySelector(".cast-roster-portrait")!;
    const name = target.querySelector(".cast-roster-name")!;
    const moveWithin = new Event("dragleave", { bubbles: true });
    Object.defineProperties(moveWithin, { relatedTarget: { value: name }, dataTransfer: { value: dataTransfer } });
    fireEvent(portrait, moveWithin);
    expect(target).toHaveClass("drop-target");
    fireEvent.dragLeave(target, { dataTransfer, relatedTarget: document.body });
    expect(target).not.toHaveClass("drop-target");
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.dragEnd(source, { dataTransfer });
    expect(target).not.toHaveClass("drop-target");
    expect(source).not.toHaveClass("dragging");
    expect(screen.getByRole("button", { name: "Inspect Cecilus" })).toBeInTheDocument();
  });

  it("scrolls progressively near the viewport edge and stops when the drag leaves it", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const scrollBy = vi.fn();
    Object.defineProperty(window, "scrollBy", { configurable: true, value: scrollBy });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const runFrame = (id: number, timestamp: number) => {
      const callback = frames.get(id)!;
      frames.delete(id);
      callback(timestamp);
    };
    render(<Harness />);
    const source = screen.getByRole("button", { name: "Inspect Cecilus" });
    const dataTransfer = transfer();

    fireEvent.dragStart(source, { clientY: 400, dataTransfer });
    dragOverAt(source, 720, dataTransfer);
    expect(screen.getByText("↓ Scroll down")).toBeInTheDocument();

    runFrame(1, 100);
    runFrame(2, 116);
    expect(scrollBy).toHaveBeenCalledOnce();
    const shallowEdgeDistance = scrollBy.mock.calls[0][0].top;
    expect(shallowEdgeDistance).toBeGreaterThan(0);

    dragOverAt(source, 795, dataTransfer);
    runFrame(3, 132);
    expect(scrollBy.mock.calls[1][0].top).toBeGreaterThan(shallowEdgeDistance);

    dragOverAt(source, 400, dataTransfer);
    expect(screen.queryByText("↓ Scroll down")).not.toBeInTheDocument();
    const scrollCount = scrollBy.mock.calls.length;
    expect(frames.size).toBe(0);
    expect(scrollBy).toHaveBeenCalledTimes(scrollCount);

    dragOverAt(source, 1, dataTransfer);
    expect(screen.getByText("↑ Scroll up")).toBeInTheDocument();
    fireEvent.dragEnd(source, { dataTransfer });
    expect(screen.queryByText("↑ Scroll up")).not.toBeInTheDocument();
  });

  it("routes a cast member to Narrator and allows its labels to be restored", () => {
    render(<Harness />);
    const source = screen.getByRole("button", { name: "Inspect Emilia" });
    const narrator = screen.getByRole("button", { name: "Inspect Narrator" });
    const dataTransfer = transfer();

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(narrator, { dataTransfer });
    fireEvent.drop(narrator, { dataTransfer });
    const routed = JSON.parse(screen.getByTestId("decisions").textContent ?? "{}");
    expect(routed.Emilia).toMatchObject({ category: "narrator", canonicalName: "" });
    expect(screen.queryByRole("button", { name: "Inspect Emilia" })).not.toBeInTheDocument();

    fireEvent.click(narrator);
    const narratorDialog = screen.getByRole("dialog", { name: "Inspect Narrator" });
    expect(narratorDialog).toHaveTextContent("Permanent primary");
    expect(within(narratorDialog).queryByLabelText("Narrator voice direction")).not.toBeInTheDocument();
    expect(within(narratorDialog).queryByLabelText("Narrator voice model")).not.toBeInTheDocument();
    expect(narratorDialog).toHaveTextContent("Choose the narrator voice in the next step");
    expect(within(narratorDialog).queryByRole("group", { name: "Book language" })).not.toBeInTheDocument();
    fireEvent.click(within(narratorDialog).getByRole("button", { name: "Pop out to cast" }));
    expect(screen.getByRole("button", { name: "Inspect Emilia" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Inspect Narrator" })).toBeInTheDocument();
  });

  it("closes only when the backdrop itself is clicked", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Cecilus" }));
    const dialog = screen.getByRole("dialog", { name: "Inspect Cecilus" });
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog", { name: "Inspect Cecilus" })).not.toBeInTheDocument();
  });
});
