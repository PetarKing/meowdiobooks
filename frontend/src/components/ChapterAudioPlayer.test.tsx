import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterAudioPlayer } from "./ChapterAudioPlayer";

function renderPlayer() {
  const { container } = render(<ChapterAudioPlayer src="/chapter.m4a" />);
  return { container, audio: container.querySelector("audio")! };
}

describe("ChapterAudioPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
