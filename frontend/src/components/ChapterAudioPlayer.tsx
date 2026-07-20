export interface ChapterAudioPlayerProps {
  src: string;
}

/** Keep playback native so the browser owns buffering, seeking, and retry behavior. */
export function ChapterAudioPlayer({ src }: ChapterAudioPlayerProps) {
  return <audio controls preload="metadata" src={src} />;
}
