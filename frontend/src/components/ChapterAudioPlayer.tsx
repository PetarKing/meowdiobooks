import { useCallback, useEffect, useRef, type SyntheticEvent } from "react";

const endToleranceSeconds = 0.75;
const retryProgressSeconds = 1;
const stalledRecoveryDelayMs = 3000;

export interface ChapterAudioPlayerProps {
  src: string;
}

/** Preserve the native player while recovering one interrupted media request in place. */
export function ChapterAudioPlayer({ src }: ChapterAudioPlayerProps) {
  const lastPosition = useRef(0);
  const retryPosition = useRef(-1);
  const hasPlayed = useRef(false);
  const retrying = useRef(false);
  const stalledRecovery = useRef<number | undefined>(undefined);

  const clearStalledRecovery = useCallback(() => {
    if (stalledRecovery.current === undefined) return;
    window.clearTimeout(stalledRecovery.current);
    stalledRecovery.current = undefined;
  }, []);

  useEffect(() => {
    clearStalledRecovery();
    lastPosition.current = 0;
    retryPosition.current = -1;
    hasPlayed.current = false;
    retrying.current = false;
    return clearStalledRecovery;
  }, [clearStalledRecovery, src]);

  function rememberPosition(event: SyntheticEvent<HTMLAudioElement>) {
    const position = event.currentTarget.currentTime;
    if (!Number.isFinite(position) || position < 0) return;
    clearStalledRecovery();
    lastPosition.current = Math.max(lastPosition.current, position);
    if (position >= retryPosition.current + retryProgressSeconds) {
      retrying.current = false;
    }
  }

  function recover(audio: HTMLAudioElement) {
    clearStalledRecovery();
    const duration = audio.duration;
    const position = lastPosition.current;
    const reachedEnd = Number.isFinite(duration) && position >= duration - endToleranceSeconds;
    if (!hasPlayed.current || reachedEnd || retrying.current) return;

    retrying.current = true;
    retryPosition.current = position;
    audio.addEventListener("loadedmetadata", () => {
      const latestDuration = audio.duration;
      if (position > 0 && Number.isFinite(latestDuration)) {
        audio.currentTime = Math.min(position, Math.max(0, latestDuration - endToleranceSeconds));
      }
      void audio.play().catch(() => undefined);
    }, { once: true });
    audio.load();
  }

  function recoverIfStillStalled(audio: HTMLAudioElement) {
    if (!hasPlayed.current || retrying.current || stalledRecovery.current !== undefined) return;
    const stalledAt = audio.currentTime;
    stalledRecovery.current = window.setTimeout(() => {
      stalledRecovery.current = undefined;
      const position = audio.currentTime;
      const madeProgress = Number.isFinite(position)
        && Number.isFinite(stalledAt)
        && position >= stalledAt + retryProgressSeconds;
      if (!audio.paused && !madeProgress) recover(audio);
    }, stalledRecoveryDelayMs);
  }

  function handleEnded(event: SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget;
    const duration = audio.duration;
    const reachedEnd = Number.isFinite(duration)
      && lastPosition.current >= duration - endToleranceSeconds;
    if (reachedEnd) {
      hasPlayed.current = false;
      retrying.current = false;
      return;
    }
    recover(audio);
  }

  return (
    <audio
      controls
      preload="auto"
      src={src}
      onPlay={() => { hasPlayed.current = true; }}
      onPause={clearStalledRecovery}
      onPlaying={clearStalledRecovery}
      onCanPlay={clearStalledRecovery}
      onTimeUpdate={rememberPosition}
      onWaiting={(event) => recoverIfStillStalled(event.currentTarget)}
      onStalled={(event) => recoverIfStillStalled(event.currentTarget)}
      onError={(event) => recover(event.currentTarget)}
      onEnded={handleEnded}
    />
  );
}
