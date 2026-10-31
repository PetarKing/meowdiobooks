import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterAudioPlayer } from "./ChapterAudioPlayer";

const chapter = { src: "/chapter.m4a", title: "Down the Rabbit-Hole", bookTitle: "Alice's Adventures in Wonderland", author: "Lewis Carroll" };

function renderPlayer() {
  const rendered = render(<ChapterAudioPlayer {...chapter} />);
  return { ...rendered, audio: rendered.container.querySelector("audio")! };
}

function mockMediaSession() {
  const session = { metadata: null as MediaMetadata | null };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  vi.stubGlobal("MediaMetadata", class {
    constructor(metadata: MediaMetadataInit) { Object.assign(this, metadata); }
  });
  return session;
}

describe("ChapterAudioPlayer", () => {
  const originalSession = Object.getOwnPropertyDescriptor(navigator, "mediaSession");
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalSession) Object.defineProperty(navigator, "mediaSession", originalSession);
    else Reflect.deleteProperty(navigator, "mediaSession");
  });

  it("uses the native metadata-only audio control", () => {
    const { audio, container } = renderPlayer();

    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "metadata");
    expect(audio).toHaveAttribute("src", "/chapter.m4a");
    expect(container.children).toHaveLength(1);
  });

  it("never reloads or programmatically resumes after native media events", () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { audio } = renderPlayer();

    fireEvent.waiting(audio);
    fireEvent.stalled(audio);
    fireEvent.error(audio);
    fireEvent.ended(audio);

    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("publishes chapter identity and the full-resolution brand PNG only when playback starts", () => {
    const session = mockMediaSession();
    const previous = { title: "Another recording" } as MediaMetadata;
    session.metadata = previous;
    const { audio, unmount } = renderPlayer();
    expect(session.metadata).toBe(previous);

    fireEvent.play(audio);
    expect(session.metadata).toMatchObject({
      title: chapter.title, album: chapter.bookTitle, artist: chapter.author,
      artwork: [{ src: expect.stringContaining("meowdiobooks-icon-512.png"), sizes: "512x512", type: "image/png" }],
    });
    fireEvent.pause(audio);
    expect(session.metadata?.title).toBe(chapter.title);
    unmount();
    expect(session.metadata).toBeNull();
  });

  it("does not clear another player's metadata when closing", () => {
    const session = mockMediaSession();
    const { audio, unmount } = renderPlayer();
    fireEvent.play(audio);
    const newer = { title: "Another recording" } as MediaMetadata;
    session.metadata = newer;
    unmount();
    expect(session.metadata).toBe(newer);
  });

  it("clears the former chapter on source changes and publishes the new identity on play", () => {
    const session = mockMediaSession();
    const { audio, rerender } = renderPlayer();
    fireEvent.play(audio);
    rerender(<ChapterAudioPlayer {...chapter} src="/next.m4a" title="The Pool of Tears" author="" />);
    expect(session.metadata).toBeNull();
    fireEvent.play(audio);
    expect(session.metadata).toMatchObject({ title: "The Pool of Tears", artist: "Meowdiobooks" });
  });

  it("keeps native playback usable when Media Session metadata is unavailable", () => {
    const session = mockMediaSession();
    vi.stubGlobal("MediaMetadata", undefined);
    const { audio } = renderPlayer();
    fireEvent.play(audio);
    expect(session.metadata).toBeNull();
    expect(audio).toHaveAttribute("controls");
  });
});
