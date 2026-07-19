import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterAudioPlayer } from "./ChapterAudioPlayer";

function audioFixture(duration: number, paused = false) {
  const { container } = render(<ChapterAudioPlayer src="/chapter.wav" />);
  const audio = container.querySelector("audio")!;
  let currentTime = 0;
  Object.defineProperties(audio, {
    duration: { configurable: true, get: () => duration },
    paused: { configurable: true, get: () => paused },
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => { currentTime = value; },
    },
  });
  return { audio, setCurrentTime: (value: number) => { currentTime = value; } };
}

describe("ChapterAudioPlayer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the existing native audio control contract", () => {
    const { audio } = audioFixture(100);

    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "auto");
    expect(audio).toHaveAttribute("src", "/chapter.wav");
    expect(audio.parentElement?.children).toHaveLength(1);
  });

  it("reloads and resumes after a premature end without changing the player", async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { audio, setCurrentTime } = audioFixture(100);
    fireEvent.play(audio);
    setCurrentTime(24);
    fireEvent.timeUpdate(audio);

    setCurrentTime(0);
    fireEvent.ended(audio);

    expect(load).toHaveBeenCalledOnce();
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(24);
    expect(play).toHaveBeenCalledOnce();
  });

  it("does not retry a natural end or an initial metadata error", () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { audio, setCurrentTime } = audioFixture(100);

    fireEvent.error(audio);
    expect(load).not.toHaveBeenCalled();

    fireEvent.play(audio);
    setCurrentTime(100);
    fireEvent.timeUpdate(audio);
    fireEvent.ended(audio);
    expect(load).not.toHaveBeenCalled();
  });

  it("waits for native buffering before recovering a persistent stall", () => {
    vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { audio, setCurrentTime } = audioFixture(100);
    fireEvent.play(audio);
    setCurrentTime(12);
    fireEvent.timeUpdate(audio);

    fireEvent.waiting(audio);
    vi.advanceTimersByTime(2999);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledOnce();
  });

  it("leaves a recovered native buffer alone", () => {
    vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { audio } = audioFixture(100);
    fireEvent.play(audio);
    fireEvent.waiting(audio);
    fireEvent.canPlay(audio);

    vi.advanceTimersByTime(3000);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not turn an intentional pause into a reload", () => {
    vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { audio } = audioFixture(100);
    fireEvent.play(audio);
    fireEvent.stalled(audio);
    fireEvent.pause(audio);

    vi.advanceTimersByTime(3000);
    expect(load).not.toHaveBeenCalled();
  });
});
