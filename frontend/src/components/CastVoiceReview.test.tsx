import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CastArtifact, VoiceRoute } from "../api/contracts";
import i18n from "../i18n";
import { CastVoiceReview } from "./CastVoiceReview";

const cast: CastArtifact = {
  revision: "cast-voice-1",
  phase: "audition-review",
  dossiers: [],
  proposals: [],
  language: "english",
  narrator: {
    characterId: "narrator",
    name: "Narrator",
    category: "narrator",
    lineCount: 12,
    voicePreviewRevision: "narrator-1",
    previewUrl: "/narrator.wav",
    referenceText: "This is the voice of Narrator.",
    voiceDirection: "Warm narrator.",
  },
  identities: [
    { characterId: "few", name: "Few", lineCount: 2, voicePreviewRevision: "few-1", previewUrl: "/few.wav", referenceText: "This is the voice of Few.", voiceDirection: "Quiet." },
    {
      characterId: "many",
      name: "Many",
      lineCount: 20,
      voicePreviewRevision: "many-3",
      previewUrl: "/many-3.wav",
      referenceText: "This is the voice of Many.",
      voiceDirection: "Bright.",
      voiceSettings: { presentation: "androgynous", age: "adult", tone: "bright", pitch: "medium", pace: "brisk", energy: "animated", accent: "unspecified", description: "Bright and decisive." },
      voiceCandidates: [
        {
          revision: "many-1",
          previewUrl: "/many-1.wav",
          referenceText: "This is the voice of Many.",
          direction: "Warm and measured.",
          voiceSettings: { presentation: "androgynous", age: "adult", tone: "warm", pitch: "medium", pace: "measured", energy: "balanced", accent: "unspecified", description: "Warm and measured." },
        },
        {
          revision: "many-2",
          previewUrl: "/many-2.wav",
          referenceText: "This is the voice of Many.",
          direction: "Gentle and restrained.",
          voiceSettings: { presentation: "androgynous", age: "adult", tone: "gentle", pitch: "medium", pace: "natural", energy: "restrained", accent: "Japanese", description: "Gentle and restrained." },
        },
        {
          revision: "many-3",
          previewUrl: "/many-3.wav",
          referenceText: "This is the voice of Many.",
          direction: "Bright and decisive.",
          voiceSettings: { presentation: "androgynous", age: "adult", tone: "bright", pitch: "medium", pace: "brisk", energy: "animated", accent: "unspecified", description: "Bright and decisive." },
        },
      ],
    },
  ],
};

describe("CastVoiceReview", () => {
  it("routes a missing dedicated audition to generation without treating it as ready", () => {
    const approve = vi.fn();
    const regenerate = vi.fn();
    const missing: CastArtifact = { ...cast, identities: [...cast.identities!, { characterId: "missing", name: "Missing", category: "character", referenceText: "A voice still to be made." }] };
    render(<CastVoiceReview bookId="book" cast={missing} selections={{}} routes={{}} onRouteChange={vi.fn()} onApprove={approve} onRegenerate={regenerate} />);
    const board = screen.getByRole("region", { name: "Cast voice auditions" });
    expect(within(board).getAllByRole("button", { name: /Open .* voice/ })[0]).toHaveAccessibleName("Open Missing voice");
    expect(within(board).getByRole("button", { name: "Open Missing voice" })).toHaveTextContent("Audition required");
    expect(screen.getByRole("button", { name: "Play Missing preview" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review required voices →" }));
    const dialog = screen.getByRole("dialog", { name: "Missing voice" });
    expect(dialog).toHaveTextContent("No auditions yet. Create one to hear this cast member.");
    expect(dialog).not.toHaveTextContent("Listen, then choose a voice.");
    expect(within(dialog).queryByRole("button", { name: /Approve Audition/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Voice traits" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new audition" }));
    const generate = within(dialog).getByRole("button", { name: "Generate new audition →" });
    expect(generate).toBeEnabled();
    expect(approve).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
    fireEvent.click(generate);
    expect(regenerate).toHaveBeenCalledWith("missing", expect.objectContaining({ description: "" }));
    expect(approve).not.toHaveBeenCalled();
  });

  it("plays an audition with one toggle without applying it", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const approve = vi.fn();
    try {
      render(<CastVoiceReview bookId="book" cast={cast} selections={{}} routes={{}} onRouteChange={vi.fn()} onApprove={approve} onRegenerate={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
      const dialog = screen.getByRole("dialog", { name: "Many voice" });
      const playNewest = within(dialog).getByRole("button", { name: "Play Audition 3" });
      fireEvent.click(playNewest);
      expect(play).toHaveBeenCalledTimes(1);
      const stopNewest = within(dialog).getByRole("button", { name: "Stop Audition 3" });
      expect(stopNewest).toHaveAttribute("aria-pressed", "true");
      expect(approve).not.toHaveBeenCalled();
      fireEvent.click(stopNewest);
      expect(within(dialog).getByRole("button", { name: "Play Audition 3" })).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(within(dialog).getByRole("button", { name: "Play Audition 2" }));
      const audio = dialog.querySelector<HTMLAudioElement>(".voice-candidate-audio");
      expect(audio?.getAttribute("src")).toBe("/many-2.wav");
      if (audio) fireEvent.ended(audio);
      expect(within(dialog).getByRole("button", { name: "Play Audition 2" })).toHaveAttribute("aria-pressed", "false");
      expect(approve).not.toHaveBeenCalled();
    } finally {
      play.mockRestore();
      pause.mockRestore();
    }
  });

  it("searches large ensembles by labels while keeping required review totals visible", () => {
    const ensemble: CastArtifact = { ...cast, identities: [
      ...Array.from({ length: 13 }, (_, index) => ({ ...cast.identities![0], characterId: `member-${index}`, name: index === 0 ? "Émilia" : `Member ${index}`, literalLabels: index === 0 ? ["Moonlight"] : [], voicePreviewRevision: `v-${index}` })),
      { characterId: "duet", name: "Duet", category: "group", voiceRoute: { kind: "layered", characterIds: ["member-0", "member-1"] } },
    ] };
    const approve = vi.fn();
    render(<CastVoiceReview bookId="book" cast={ensemble} selections={{}} routes={{}} onRouteChange={vi.fn()} onApprove={approve} onRegenerate={vi.fn()} />);
    const board = screen.getByRole("region", { name: "Cast voice auditions" });
    expect(within(board).getAllByRole("button", { name: /Open .* voice/ })[0]).toHaveAccessibleName("Open Duet voice");
    const search = screen.getByRole("searchbox", { name: "Search cast" });
    search.focus();
    fireEvent.change(search, { target: { value: "moonLIGHT" } });
    expect(screen.getByRole("button", { name: "Open Émilia voice" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Duet voice" })).not.toBeInTheDocument();
    expect(screen.getByText("1 required")).toBeInTheDocument();
    expect(screen.getByText("1 of 15 cast members shown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review required voices →" }));
    const requiredDialog = screen.getByRole("dialog", { name: "Duet voice" });
    expect(requiredDialog).toHaveTextContent("Confirm suggested voices");
    expect(approve).not.toHaveBeenCalled();
    fireEvent.keyDown(requiredDialog, { key: "Escape" });
    fireEvent.animationEnd(requiredDialog);

    fireEvent.change(search, { target: { value: "emilia" } });
    expect(screen.getByRole("button", { name: "Open Émilia voice" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Show cast" }), { target: { value: "required" } });
    expect(screen.getByText("No cast members match these filters.")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "Open Duet voice" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Émilia voice" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(search).toHaveFocus();
    expect(screen.getByText("15 of 15 cast members shown")).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
  });

  it("returns focus to collection search when approving removes the inspected filtered tile", () => {
    const ensemble: CastArtifact = { ...cast, identities: Array.from({ length: 13 }, (_, index) => ({ ...cast.identities![0], characterId: `member-${index}`, name: `Member ${index}`, voicePreviewRevision: `v-${index}` })) };
    const props = { bookId: "book", cast: ensemble, routes: {}, onRouteChange: vi.fn(), onApprove: vi.fn(), onRegenerate: vi.fn() };
    const view = render(<CastVoiceReview {...props} selections={{}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Show cast" }), { target: { value: "ready" } });
    const trigger = screen.getByRole("button", { name: "Open Member 0 voice" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Member 0 voice" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply Audition 1" }));
    view.rerender(<CastVoiceReview {...props} selections={{ "member-0": "v-0" }} />);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close voice" }));
    fireEvent.animationEnd(dialog);
    expect(screen.queryByRole("button", { name: "Open Member 0 voice" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search cast" })).toHaveFocus();
    expect(props.onApprove).toHaveBeenCalledWith("member-0", "v-0");
  });

  it("gives voice inspectors shared keyboard focus, Escape, and scroll locking", () => {
    render(<CastVoiceReview bookId="book" cast={cast} selections={{}} routes={{}} onRouteChange={vi.fn()} onApprove={vi.fn()} onRegenerate={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Open Many voice" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "Close voice" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toHaveClass("closing");
    fireEvent.animationEnd(dialog);
    expect(screen.queryByRole("dialog", { name: "Many voice" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("offers an optional source voice picker only when opened", async () => {
    const load = vi.fn().mockResolvedValue({ sources: [{ bookId: "earlier", title: "Earlier book", voiceCount: 1, voices: [{ characterId: "different", name: "Different name", revision: "v1" }] }], exactMatchCount: 0, remainingVoiceCount: 3, totalVoiceCount: 3 });
    const reuse = vi.fn();
    render(<CastVoiceReview bookId="book" cast={cast} selections={{}} routes={{}} onRouteChange={vi.fn()} onApprove={vi.fn()} onRegenerate={vi.fn()} loadSourceVoices={load} onReuseVoice={reuse} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create a new audition" }));
    const details = screen.getByText("Use a voice from another book").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const select = await screen.findByRole("combobox", { name: "Existing voice" });
    fireEvent.change(select, { target: { value: JSON.stringify({ bookId: "earlier", characterId: "different", revision: "v1" }) } });
    fireEvent.click(screen.getByRole("button", { name: "Use voice" }));
    expect(reuse).toHaveBeenCalledWith("many", { bookId: "earlier", characterId: "different", revision: "v1" });
  });

  it("drafts an editable transcript and uses a compact player before submission", async () => {
    const onUpload = vi.fn();
    const onTranscribe = vi.fn().mockResolvedValue({ text: "An imperfect automatic draft.", language: "English" });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const props = { bookId: "book-1", selections: {}, routes: {}, onRouteChange: () => undefined, onApprove: () => undefined, onRegenerate: () => undefined, onTranscribe, onUpload };
    const view = render(<CastVoiceReview {...props} cast={cast} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new audition" }));
    const sample = new File(["voice"], "many.flac", { type: "audio/flac" });

    expect(within(dialog).getByRole("radiogroup", { name: "Audition source" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Clone from a sample/ }));
    expect(within(dialog).queryByRole("group", { name: "Voice traits" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("Generate this line in the sampled voice")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create sampled audition →" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Choose voice sample"), {
      target: { files: [sample] },
    });
    expect(within(dialog).getByLabelText("Selected voice sample preview")).toHaveAttribute("src", "blob:local-preview");
    expect(within(dialog).getByText("many.flac")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Selected voice sample preview")).not.toHaveAttribute("controls");
    expect(onUpload).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByLabelText("Voice sample transcript")).toHaveValue("An imperfect automatic draft."));
    expect(dialog).toHaveTextContent("Drafted in English. Check every word before continuing.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Play selected voice sample" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.change(within(dialog).getByLabelText("Voice sample transcript"), {
      target: { value: "These are the exact words in my sample." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sampled audition →" }));

    expect(onUpload).toHaveBeenCalledWith(
      "many", sample, "These are the exact words in my sample.",
    );
    const many = cast.identities![1];
    view.rerender(<CastVoiceReview {...props} cast={{ ...cast, identities: [cast.identities![0], { ...many, voicePreviewRevision: "many-sample", voiceCandidates: [...many.voiceCandidates!, { revision: "many-sample", previewUrl: "/many-sample.wav", referenceText: "A sampled line.", direction: "Sampled.", source: "upload" }] }] }} />);
    expect(await within(dialog).findByRole("button", { name: "Play Audition 4" })).toHaveFocus();
    play.mockRestore();
  });

  it("keeps auditions and applies the exact candidate with one click without deletion", () => {
    const onDelete = vi.fn();
    const onApprove = vi.fn();
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={onApprove} onRegenerate={() => undefined} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
    expect(within(dialog).queryByRole("button", { name: /Delete Audition/ })).not.toBeInTheDocument();
    const earlier = within(dialog).getByRole("button", { name: "Apply Audition 1" });
    fireEvent.click(within(earlier).getByText("Warm · Measured · neutral accent"));
    expect(onApprove).toHaveBeenCalledWith("many", "many-1");
    expect(dialog).not.toHaveClass("closing");
    expect(within(dialog).queryByRole("button", { name: /Approve Audition/ })).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("skips connector punctuation when building joint-speaker initials", () => {
    const jointCast: CastArtifact = {
      ...cast,
      identities: [
        ...(cast.identities ?? []),
        {
          characterId: "subaru-cecilus",
          name: "Subaru & Cecilus",
          lineCount: 19,
          voicePreviewRevision: "subaru-cecilus-1",
          previewUrl: "/subaru-cecilus.wav",
          referenceText: "Together.",
          voiceDirection: "Joint delivery.",
        },
      ],
    };

    render(<CastVoiceReview bookId="book-1" cast={jointCast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);

    expect(within(screen.getByRole("button", { name: "Play Subaru & Cecilus preview" })).getByText("S&C")).toBeInTheDocument();
  });

  it("shows exact group members for confirmation and refreshes the combined preview when an applied audition changes", () => {
    const onConfirmRoute = vi.fn();
    const groupCast: CastArtifact = {
      ...cast,
      identities: [
        { characterId: "subaru", name: "Subaru", category: "character", literalLabels: ["Subaru"], voicePreviewRevision: "subaru-2", previewUrl: "/subaru-2.wav", referenceText: "Subaru preview.", voiceDirection: "Steady.", voiceCandidates: [
          { revision: "subaru-1", previewUrl: "/subaru-1.wav", referenceText: "Subaru preview.", direction: "Steady." },
          { revision: "subaru-2", previewUrl: "/subaru-2.wav", referenceText: "Subaru preview.", direction: "Brighter." },
        ] },
        { characterId: "cecilus", name: "Cecilus", category: "character", literalLabels: ["Cecilus"], voicePreviewRevision: "cecilus-1", previewUrl: "/cecilus.wav", referenceText: "Cecilus preview.", voiceDirection: "Bright." },
        { characterId: "subaru-cecilus", name: "Subaru & Cecilus", category: "group", literalLabels: ["Subaru & Cecilus"], voicePreviewRevision: "group-1", previewUrl: "/group.wav", referenceText: "Together.", voiceDirection: "Joint." },
      ],
    };
    const route: Record<string, VoiceRoute> = { "subaru-cecilus": { kind: "layered", characterIds: ["subaru", "cecilus"] } };
    const view = render(<CastVoiceReview bookId="book-1" cast={groupCast} selections={{ subaru: "subaru-1", cecilus: "cecilus-1" }} routes={route} confirmedRoutes={{ "subaru-cecilus": false }} onRouteChange={() => undefined} onConfirmRoute={onConfirmRoute} onApprove={() => undefined} onRegenerate={() => undefined} />);
    const groupTile = screen.getByRole("button", { name: "Open Subaru & Cecilus voice" });
    expect(groupTile).toHaveClass("voice-required", "needs-review");
    expect(groupTile).toHaveAttribute("aria-description", "Required: confirm suggested voices");
    expect(screen.getByText("1 required")).toBeInTheDocument();
    expect(screen.getByText("1 not yet approved")).toBeInTheDocument();
    fireEvent.click(groupTile);

    expect(screen.getByText("Subaru + Cecilus")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm layered voices" }));
    expect(onConfirmRoute).toHaveBeenCalledWith("subaru-cecilus");

    const originalPreview = screen.getByText("Combined preview").closest(".voice-route-preview")?.querySelector("audio");
    expect(originalPreview).toHaveAttribute("src", "/api/books/book-1/voices/layered/audio?member=subaru%3Asubaru-1&member=cecilus%3Acecilus-1");
    view.rerender(<CastVoiceReview bookId="book-1" cast={groupCast} selections={{ subaru: "subaru-2", cecilus: "cecilus-1" }} routes={route} confirmedRoutes={{ "subaru-cecilus": true }} onRouteChange={() => undefined} onConfirmRoute={onConfirmRoute} onApprove={() => undefined} onRegenerate={() => undefined} />);
    const refreshedPreview = screen.getByText("Combined preview").closest(".voice-route-preview")?.querySelector("audio");
    expect(refreshedPreview).not.toBe(originalPreview);
    expect(refreshedPreview).toHaveAttribute("src", "/api/books/book-1/voices/layered/audio?member=subaru%3Asubaru-2&member=cecilus%3Acecilus-1");
    expect(screen.getByRole("button", { name: "Play Subaru & Cecilus preview" })).toBeEnabled();

    const resolvePreview = vi.fn(() => "/host/layered-preview.wav");
    view.rerender(<CastVoiceReview bookId="book-1" cast={groupCast} selections={{ subaru: "subaru-2", cecilus: "cecilus-1" }} routes={route} layeredVoicePreviewUrl={resolvePreview} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);
    expect(resolvePreview).toHaveBeenCalledWith("book-1", [
      { characterId: "subaru", revision: "subaru-2" },
      { characterId: "cecilus", revision: "cecilus-1" },
    ]);
    expect(screen.getByText("Combined preview").closest(".voice-route-preview")?.querySelector("audio")).toHaveAttribute("src", "/host/layered-preview.wav");
    resolvePreview.mockClear();
    view.rerender(<CastVoiceReview bookId="book-1" cast={groupCast} selections={{}} routes={{ "subaru-cecilus": { kind: "layered", characterIds: ["subaru", "missing"] } }} layeredVoicePreviewUrl={resolvePreview} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);
    expect(resolvePreview).not.toHaveBeenCalled();
  });

  it("pins Narrator, orders the cast by line count, and marks unapproved voices", () => {
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);
    const tiles = within(screen.getByRole("region", { name: "Cast voice auditions" })).getAllByRole("button", { name: /^Open / });
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Open Narrator voice", "Open Many voice", "Open Few voice",
    ]);
    expect(tiles[1]).toHaveClass("voice-default-ready");
    expect(tiles[1]).toHaveAttribute("aria-description", "not yet approved");
    expect(tiles[1]).toHaveTextContent("Not yet approved");
    expect(tiles[1]).not.toHaveTextContent("20 lines");
    expect(screen.getByText("3 not yet approved")).toBeInTheDocument();
    expect(screen.queryByText(/Listen first|voices can be approved when you continue/)).not.toBeInTheDocument();
  });

  it("marks reused auditions as informative shared voices with matching initials colors", () => {
    const sharedCandidate = {
      revision: "shared-1",
      previewUrl: "/shared.wav",
      referenceText: "A neutral supporting cast line.",
      direction: "Adult masculine supporting voice.",
      source: "shared" as const,
      sharedVoiceGroupId: "shared-voice-01",
    };
    const secondSharedCandidate = {
      ...sharedCandidate,
      revision: "shared-2",
      previewUrl: "/shared-2.wav",
      sharedVoiceGroupId: "shared-voice-02",
    };
    const sharedCast: CastArtifact = {
      ...cast,
      identities: [
        { characterId: "guard", name: "Guard", lineCount: 1, voicePreviewRevision: "shared-1", voiceCandidates: [sharedCandidate] },
        { characterId: "rebel", name: "Rebel", lineCount: 2, voicePreviewRevision: "shared-1", voiceCandidates: [sharedCandidate] },
        { characterId: "merchant", name: "Merchant", lineCount: 3, voicePreviewRevision: "shared-2", voiceCandidates: [secondSharedCandidate] },
        { characterId: "porter", name: "Porter", lineCount: 4, voicePreviewRevision: "shared-2", voiceCandidates: [secondSharedCandidate] },
      ],
    };

    render(<CastVoiceReview bookId="book-1" cast={sharedCast} selections={{ guard: "shared-1", rebel: "shared-1", merchant: "shared-2", porter: "shared-2" }} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);

    const guard = screen.getByRole("button", { name: "Open Guard voice" });
    const rebel = screen.getByRole("button", { name: "Open Rebel voice" });
    const merchant = screen.getByRole("button", { name: "Open Merchant voice" });
    expect(guard).toHaveClass("shared-voice-0");
    expect(rebel).toHaveClass("shared-voice-0");
    expect(merchant).toHaveClass("shared-voice-1");
    expect(guard).toHaveAttribute("data-shared-voice-group", "shared-voice-01");
    expect(guard.style.getPropertyValue("--shared-voice-accent")).toBe(
      rebel.style.getPropertyValue("--shared-voice-accent"),
    );
    expect(guard.style.getPropertyValue("--shared-voice-accent")).not.toBe(
      merchant.style.getPropertyValue("--shared-voice-accent"),
    );
    expect(guard).toHaveAttribute("aria-description", "shared voice");
    expect(screen.queryByText(/Brief roles may share a voice to save time and cost/)).not.toBeInTheDocument();

    fireEvent.click(guard);
    expect(within(screen.getByRole("dialog", { name: "Guard voice" })).getByText("Shared voice")).toBeInTheDocument();
  });

  it("plays the current preview from a tile without opening the inspector", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);

    const preview = screen.getByRole("button", { name: "Play Many preview" });
    expect(within(preview).getByText("M")).toBeInTheDocument();
    fireEvent.click(preview);

    expect(play).toHaveBeenCalledOnce();
    const pausePreview = screen.getByRole("button", { name: "Pause Many preview" });
    expect(pausePreview).toHaveAttribute("aria-pressed", "true");
    expect(within(pausePreview).queryByText("M")).not.toBeInTheDocument();
    expect(pausePreview.querySelectorAll(".voice-tile-wave i")).toHaveLength(5);
    expect(screen.queryByRole("dialog", { name: "Many voice" })).not.toBeInTheDocument();
    fireEvent.click(pausePreview);
    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("button", { name: "Play Many preview" })).getByText("M")).toBeInTheDocument();
    play.mockRestore();
    pause.mockRestore();
  });

  it("renders structured settings and submits edited handles", () => {
    const onRegenerate = vi.fn();
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
    expect(dialog).toHaveTextContent("20 lines");
    expect(within(dialog).queryByRole("group", { name: "Voice traits" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new audition" }));
    expect(within(dialog).getByLabelText("Gender")).toHaveValue("androgynous");
    fireEvent.change(within(dialog).getByLabelText("Pace"), { target: { value: "measured" } });
    expect(within(dialog).getByLabelText("Accent")).toHaveAttribute(
      "placeholder", "e.g. Japanese or Southern English",
    );
    expect(within(dialog).getByRole("group", { name: "Voice traits" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Direction" })).toBeInTheDocument();
    const notes = within(dialog).getByRole("textbox", { name: "Performance notes" });
    expect(notes).toHaveAttribute("maxlength", "180");
    fireEvent.change(notes, { target: { value: "" } });
    expect(within(dialog).getByRole("button", { name: "Generate new audition →" })).toBeEnabled();
    expect(within(dialog).getByRole("heading", { name: "Create a new audition" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Back to auditions/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Your existing auditions stay available.");
    expect(dialog).not.toHaveTextContent("Voice approved");
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate new audition →" }));
    expect(onRegenerate).toHaveBeenCalledWith("many", expect.objectContaining({ pace: "measured" }));
  });

  it("returns to auditions and focuses playback when the first generated voice arrives", async () => {
    const missingVoice = { characterId: "missing", name: "Missing", category: "character" as const, referenceText: "A first line." };
    const firstCast: CastArtifact = { ...cast, identities: [missingVoice] };
    const props = { bookId: "book-1", selections: {}, routes: {}, onRouteChange: vi.fn(), onApprove: vi.fn(), onRegenerate: vi.fn() };
    const view = render(<CastVoiceReview {...props} cast={firstCast} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Missing voice" }));
    const dialog = screen.getByRole("dialog", { name: "Missing voice" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new audition" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate new audition →" }));
    expect(props.onRegenerate).toHaveBeenCalledOnce();

    view.rerender(<CastVoiceReview {...props} cast={{ ...firstCast, identities: [{ ...missingVoice, voicePreviewRevision: "missing-1", previewUrl: "/missing-1.wav" }] }} />);
    const play = await within(dialog).findByRole("button", { name: "Play Audition 1" });
    expect(play).toHaveFocus();
    expect(dialog).not.toHaveTextContent("Create a new audition →");
  });

  it("returns to the newest playable audition after generating a replacement", async () => {
    const props = { bookId: "book-1", selections: {}, routes: {}, onRouteChange: vi.fn(), onApprove: vi.fn(), onRegenerate: vi.fn() };
    const view = render(<CastVoiceReview {...props} cast={cast} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new audition" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate new audition →" }));
    const many = cast.identities![1];
    const nextCast: CastArtifact = { ...cast, identities: [cast.identities![0], { ...many, voicePreviewRevision: "many-4", previewUrl: "/many-4.wav", voiceCandidates: [...many.voiceCandidates!, { revision: "many-4", previewUrl: "/many-4.wav", referenceText: "New audition.", direction: "New sound." }] }] };
    view.rerender(<CastVoiceReview {...props} cast={nextCast} />);
    const play = await within(dialog).findByRole("button", { name: "Play Audition 4" });
    expect(play).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Apply Audition 4" })).toBeInTheDocument();
  });

  it("applies any preserved candidate on click and keeps the inspector open for comparison", () => {
    const onApprove = vi.fn();
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{ many: "many-1" }} routes={{}} onRouteChange={() => undefined} onApprove={onApprove} onRegenerate={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });

    expect(within(dialog).getByRole("button", { name: "Apply Audition 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).queryByRole("button", { name: "Approve Audition 1" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply Audition 2" }));

    expect(onApprove).toHaveBeenCalledWith("many", "many-2");
    expect(dialog).not.toHaveClass("closing");
    expect(within(dialog).getByRole("button", { name: "Create a new audition" })).toBeInTheDocument();
  });

  it("animates the panel closed and restores tile focus", () => {
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);
    const tile = screen.getByRole("button", { name: "Open Many voice" });
    fireEvent.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Many voice" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Close voice" }));

    expect(dialog).toHaveClass("closing");
    fireEvent.animationEnd(dialog);
    expect(screen.queryByRole("dialog", { name: "Many voice" })).not.toBeInTheDocument();
    expect(tile).toHaveFocus();
  });
  it("localizes audition receipts and line counts while preserving a user-entered accent", async () => {
    await i18n.changeLanguage("zh-CN");
    const view = render(<CastVoiceReview bookId="book-1" cast={cast} selections={{ many: "many-3" }} routes={{}} onRouteChange={vi.fn()} onApprove={vi.fn()} onRegenerate={vi.fn()} />);
    try {
      fireEvent.click(screen.getByRole("button", { name: i18n.t("Open {{name}} voice", { name: "Many" }) }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("20 行");
      expect(dialog).toHaveTextContent("声音已批准");
      expect(dialog).toHaveTextContent("明亮 · 轻快 · 中性口音");
      expect(dialog).toHaveTextContent("温柔 · 自然 · Japanese");
      expect(dialog).toHaveTextContent("最新候选声音");
      expect(dialog).toHaveTextContent("✓ 已应用");
    } finally {
      view.unmount();
      await i18n.changeLanguage("en");
    }
  });

});
