import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CastArtifact, VoiceRoute } from "../api/contracts";
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
  it("drafts an editable transcript and uses a compact player before submission", async () => {
    const onUpload = vi.fn();
    const onTranscribe = vi.fn().mockResolvedValue({ text: "An imperfect automatic draft.", language: "English" });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} onTranscribe={onTranscribe} onUpload={onUpload} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
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
    play.mockRestore();
  });

  it("deletes auditions only when another candidate remains", () => {
    const onDelete = vi.fn();
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });

    expect(within(dialog).getAllByRole("button", { name: /Delete Audition/ })).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Audition 2" }));
    expect(onDelete).toHaveBeenCalledWith("many", "many-2");
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

    expect(within(screen.getByRole("button", { name: "Open Subaru & Cecilus voice" })).getByText("S&C")).toBeInTheDocument();
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
    expect(groupTile).toHaveTextContent("Required");
    expect(screen.getByText("1 group voice requires review")).toBeInTheDocument();
    expect(screen.getByText("Red cards marked Required must be reviewed before you can continue.")).toBeInTheDocument();
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
  });

  it("pins Narrator, orders the cast by line count, and shows counts on tiles", () => {
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);
    const tiles = within(screen.getByRole("region", { name: "Cast voice auditions" })).getAllByRole("button", { name: /^Open / });
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Open Narrator voice", "Open Many voice", "Open Few voice",
    ]);
    expect(tiles[1]).toHaveTextContent("20 lines");
    expect(tiles[1]).toHaveClass("voice-default-ready");
    expect(tiles[1]).toHaveTextContent("default ready");
    expect(screen.getByText("3 voices can be approved when you continue")).toBeInTheDocument();
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
    const sharedCast: CastArtifact = {
      ...cast,
      identities: [
        { characterId: "guard", name: "Guard", lineCount: 1, voicePreviewRevision: "shared-1", voiceCandidates: [sharedCandidate] },
        { characterId: "rebel", name: "Rebel", lineCount: 2, voicePreviewRevision: "shared-1", voiceCandidates: [sharedCandidate] },
      ],
    };

    render(<CastVoiceReview bookId="book-1" cast={sharedCast} selections={{ guard: "shared-1", rebel: "shared-1" }} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);

    const guard = screen.getByRole("button", { name: "Open Guard voice" });
    const rebel = screen.getByRole("button", { name: "Open Rebel voice" });
    expect(guard).toHaveClass("shared-voice-0");
    expect(rebel).toHaveClass("shared-voice-0");
    expect(guard).toHaveTextContent("shared voice");
    expect(screen.getByText(/Brief roles may share a voice to reduce generation time and cost/)).toBeInTheDocument();

    fireEvent.click(guard);
    expect(within(screen.getByRole("dialog", { name: "Guard voice" })).getByText("Shared voice")).toBeInTheDocument();
  });

  it("plays the current preview from a tile without opening the inspector", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Play Many preview" }));

    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Pause Many preview" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Many voice" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause Many preview" }));
    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Play Many preview" })).toBeInTheDocument();
    play.mockRestore();
    pause.mockRestore();
  });

  it("renders structured settings and submits edited handles", () => {
    const onRegenerate = vi.fn();
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{}} routes={{}} onRouteChange={() => undefined} onApprove={() => undefined} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });
    expect(dialog).toHaveTextContent("20 lines");
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
    expect(dialog).toHaveTextContent("Settings affect only the next audition");
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate new audition →" }));
    expect(onRegenerate).toHaveBeenCalledWith("many", expect.objectContaining({ pace: "measured" }));
  });

  it("selects and explicitly approves any preserved candidate", () => {
    const onApprove = vi.fn();
    render(<CastVoiceReview bookId="book-1" cast={cast} selections={{ many: "many-1" }} routes={{}} onRouteChange={() => undefined} onApprove={onApprove} onRegenerate={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Many voice" }));
    const dialog = screen.getByRole("dialog", { name: "Many voice" });

    expect(within(dialog).getByRole("button", { name: "Select Audition 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).queryByRole("button", { name: "Approve Audition 1" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Audition 2" }));
    expect(onApprove).not.toHaveBeenCalled();
    const approve = within(dialog).getByRole("button", { name: "Approve Audition 2" });
    expect(approve.closest("header")).toBeInTheDocument();
    fireEvent.click(approve);

    expect(onApprove).toHaveBeenCalledWith("many", "many-2");
    expect(dialog).toHaveClass("closing");
    fireEvent.animationEnd(dialog);
    expect(screen.queryByRole("dialog", { name: "Many voice" })).not.toBeInTheDocument();
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
});
